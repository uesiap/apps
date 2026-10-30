// /apps/uesi/staff-work/v1/assets/scripts/final.js
// Generated report preview and export (PDF, Excel, Word) for the field report and the itinerary.
// <body data-kind="field|itinerary"> chooses the layout. Both share the sign-off block.
(() => {
    'use strict';

    const { $, Session, notify, setLoading } = window.UI;

    const IS_FIELD = document.body.dataset.kind !== 'itinerary';

    const KIND = IS_FIELD
        ? { path: 'Field_Report', title: 'FIELD STAFF REPORT', sheet: 'Field Report', label: 'Field Report' }
        : { path: 'Itinerary_Form', title: 'FIELD STAFF ITINERARY', sheet: 'Itinerary', label: 'Itinerary' };

    const DB_ROOT = 'apps/uesi/staff-work/v1/users';
    const ORG = 'UNION OF EVANGELICAL STUDENTS OF INDIA';
    const LOGO = 'https://uesiap.github.io/apps/uesi/staff-work/assets/icons/uesi192.jpg';
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const LOAD_TIMEOUT_MS = 20000;
    const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const MONTHS = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const KEYS = { copyTo: 'itinCopyTo_v1', role: 'itinRole_v1', signature: 'itinSignature_v1' };
    const DEFAULT_COPY_TO = [
        'UESI TG Office',
        'UESI TG State Secretary',
        'Hyderabad Regional Co-ordinator',
        'Medchal - Malkajgiri District Co-ordinator'
    ];

    // Main table columns. pct = web width, mm = PDF width, tw = Word width, xl = Excel width.
    // Both layouts total 182 mm (PDF) and 10466 twips (Word).
    const COLS = IS_FIELD
    ? [
        { key: 'date',  head: 'DATE(S)',                             pct: '9%',  mm: 16,  tw: 900,  xl: 8,  align: 'center' },
        { key: 'place', head: 'PLACE & PURPOSE',                     pct: '12%', mm: 24,  tw: 1300, xl: 12, align: 'center' },
        { key: 'act',   head: 'ACTIVITIES WITH DETAILS AND PROGRESS', pct: '74%', mm: 130, tw: 7566, xl: 74, align: 'left' },
        { key: 'kra',   head: 'KRA',                                 pct: '5%',  mm: 12,  tw: 700,  xl: 6,  align: 'center' }
    ]
    : [
        { key: 'date',  head: 'DATE(S)',                             pct: '14%', mm: 24,  tw: 1500, xl: 16, align: 'center' },
        { key: 'place', head: 'PLACE',                               pct: '22%', mm: 40,  tw: 2300, xl: 28, align: 'center' },
        { key: 'act',   head: 'ACTIVITIES WITH DETAILS AND PROGRESS', pct: '64%', mm: 118, tw: 6666, xl: 74, align: 'left' }
    ];
    const N = COLS.length;

    // "Other than KRA" section (field only): date, place, particulars. Matches the main table widths.
    const OTHER = { mm: [16, 24, 142], tw: [900, 1300, 8266] };

    const LOGO_MM = 12;
    const LOGO_EMU = 548640;
    const SIG_W_MM = 40;
    const SIG_MAX_H_MM = 20;
    const SIG_W_EMU = 1463040;
    const SIG_MAX_H_EMU = 548640;
    const EXCEL_SIGN_INDENT = '\u00A0'.repeat(28);

    if (!firebase.apps.length) {
        firebase.initializeApp({
            apiKey: '0AzyPiDT3wSi6WAuNX7YzbyJcvUgV0nyoxMwahn0',
            authDomain: 'uesi-ap-default-rtdb.firebaseio.com',
            databaseURL: 'https://uesi-ap-default-rtdb.firebaseio.com',
            projectId: 'uesi-ap'
        });
    }
    const db = firebase.database();

    /* ---------- Request from the generate page ---------- */
    const params = new URLSearchParams(location.search);
    const request = {
        name: (params.get('name') || '').trim(),
        email: (params.get('email') || '').trim(),
        base: (params.get('base') || '').trim(),
        state: (params.get('state') || '').trim(),
        region: (params.get('region') || '').trim(),
        month: Number(params.get('month')),
        year: Number(params.get('year'))
    };
    const requestOk = Boolean(
        request.base && request.state && request.region &&
        Number.isInteger(request.month) && request.month >= 1 && request.month <= 12 &&
        Number.isInteger(request.year) && request.year >= 2000 && request.year <= 2100
    );

    /* ---------- State ---------- */
    const view = { key: undefined, session: null, loaded: false, error: false };
    let model = null;

    /* ---------- Helpers ---------- */
    const pad = (n) => String(n).padStart(2, '0');
    const fmtDate = (ymd) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
    const dayOfWeek = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
    const dayGap = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
    const safeName = (s) => s.replace(/[\\/:*?"<>|]+/g, '').trim();
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
    const storageGet = (key) => {
        try { return localStorage.getItem(key); } catch (_) { return null; }
    };
    const sameKra = (a, b) => (a.kra ?? null) === (b.kra ?? null);
    const hasReflection = (m) => m.praising.length > 0 || m.prayer.length > 0;
    const numbered = (items) => items.map((t, i) => `${i + 1}. ${t}`).join('\n');
    // One KRA objective split into its own lines, keeping the user's line breaks
    const kraLines = (t) => String(t).split('\n').map((s) => s.trim()).filter(Boolean);

    const orgLine = (m) => `${ORG} - ${m.state.toUpperCase()}`;
    const dayText = (dates) => dates.map((d) => String(Number(d.slice(8, 10)))).join(', ');
    const cellText = (g, key) => {
        if (key === 'date') return dayText(g.dates);
        if (key === 'place') return g.place || '';
        if (key === 'kra') return String(g.kra);
        return g.activity || '—';
    };
    const fileBase = (m) => safeName(`${m.name} ${KIND.label} - ${m.monthName} ${m.year}`);

    function withTimeout(promise, ms) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    const el = (tag, cls = '', text) => {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (text !== undefined) node.textContent = text;
        return node;
    };
    const cell = (text, span = 1, cls = '') => {
        const td = el('td', cls, text);
        if (span > 1) td.colSpan = span;
        return td;
    };
    const tr = (cls, cells) => {
        const r = el('tr', cls);
        r.append(...cells);
        return r;
    };

    // Accepts a saved list, the older {"1": "..."} object, or plain text with one item per line
    function normalizeList(v) {
        if (!v) return [];
        if (typeof v === 'string') {
            return v.split('\n')
                .map((line) => line.trim().replace(/^\d+[.)]\s*/, '').replace(/^[*\-•]\s*/, ''))
                .filter(Boolean);
        }
        const items = Array.isArray(v)
            ? v
            : Object.keys(v).filter((k) => /^\d+$/.test(k)).sort((a, b) => a - b).map((k) => v[k]);
        return items.map((s) => String(s || '').trim()).filter(Boolean);
    }

    // Activity text: saved text, or the older purpose list (numbered when there are several points)
    function activityText(val) {
        if (typeof val.activity === 'string' && val.activity.trim()) return val.activity.trim();
        const pts = normalizeList(val.purpose);
        if (pts.length > 1) return numbered(pts);
        return pts[0] || '';
    }

    function padRow(arr) {
        const out = arr.slice();
        while (out.length < N) out.push('');
        return out;
    }

    /* ---------- Images ---------- */
    function imageInfo(dataUrl) {
        return new Promise((resolve, reject) => {
            const isJpeg = dataUrl.startsWith('data:image/jpeg');
            const img = new Image();
            img.onload = () => resolve({
                dataUrl,
                base64: dataUrl.split(',')[1],
                fmt: isJpeg ? 'JPEG' : 'PNG',
                ext: isJpeg ? 'jpeg' : 'png',
                w: img.naturalWidth,
                h: img.naturalHeight
            });
            img.onerror = reject;
            img.src = dataUrl;
        });
    }

    let logoPromise = null;
    function loadLogo() {
        if (!logoPromise) {
            logoPromise = fetch(LOGO, { cache: 'force-cache' })
                .then((r) => { if (!r.ok) throw new Error('logo'); return r.blob(); })
                .then((blob) => new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                }))
                .then(imageInfo)
                .catch((err) => {
                    console.warn('Logo unavailable:', err);
                    return null;
                });
        }
        return logoPromise;
    }

    function sigEmu(sig) {
        let cx = SIG_W_EMU;
        let cy = Math.round(cx * sig.h / sig.w);
        if (cy > SIG_MAX_H_EMU) {
            cy = SIG_MAX_H_EMU;
            cx = Math.round(cy * sig.w / sig.h);
        }
        return { cx, cy };
    }

    /* ---------- Rows: consecutive days with the same details share one row ---------- */
    function groupConsecutive(entries) {
        const out = [];
        let i = 0;
        while (i < entries.length) {
            const head = entries[i];
            let j = i + 1;
            while (
                j < entries.length &&
                entries[j].place === head.place &&
                entries[j].activity === head.activity &&
                sameKra(entries[j], head) &&
                dayGap(entries[j - 1].date, entries[j].date) === 1
            ) j++;
            out.push({ ...head, dates: entries.slice(i, j).map((e) => e.date) });
            i = j;
        }
        return out;
    }

    /* ---------- Model ---------- */
    function readFooter() {
        const saved = storageGet(KEYS.copyTo);
        const copyRaw = saved === null ? DEFAULT_COPY_TO.join('\n') : saved;
        return {
            copyTo: copyRaw.split('\n').map((s) => s.trim()).filter(Boolean),
            role: (storageGet(KEYS.role) || '').trim(),
            signatureUrl: storageGet(KEYS.signature) || '',
            name: request.name || view.session.name
        };
    }

    function buildModel(entries, kraList, reflection) {
        const monthName = MONTHS[request.month - 1];
        return {
            title: `${KIND.title} - ${monthName.toUpperCase()} ${request.year}`,
            monthName,
            year: request.year,
            state: request.state,
            region: request.region,
            base: request.base,
            name: request.name || view.session.name,
            kraList,
            mainGroups: groupConsecutive(IS_FIELD ? entries.filter((e) => e.kra !== 0) : entries),
            otherEntries: IS_FIELD ? entries.filter((e) => e.kra === 0) : [],
            praising: reflection.praising,
            prayer: reflection.prayer,
            footer: readFooter()
        };
    }

    /* ---------- Data ---------- */
    async function load() {
        const key = view.key;
        view.loaded = false;
        view.error = false;
        render();

        const safeEmail = view.session.email.replace(/\./g, '_');
        const month = pad(request.month);
        const base = `${DB_ROOT}/${safeEmail}/userData`;

        try {
            const [entriesSnap, kraSnap, refSnap] = await withTimeout(Promise.all([
                db.ref(`${base}/${KIND.path}/${request.year}/${month}`).once('value'),
                IS_FIELD ? db.ref(`${base}/KRA_Objectives/${request.year}/${month}`).once('value') : Promise.resolve(null),
                IS_FIELD ? db.ref(`${base}/Monthly_Reflection/${request.year}/${month}`).once('value') : Promise.resolve(null)
            ]), LOAD_TIMEOUT_MS);

            if (view.key !== key) return;

            const entries = [];
            entriesSnap.forEach((child) => {
                const date = child.key;
                const val = child.val();
                if (!DATE_RE.test(date) || !val || typeof val !== 'object') return;
                entries.push({
                    date,
                    day: val.day || dayOfWeek(date),
                    kra: IS_FIELD ? Number(val.kra ?? 0) : null,
                    // Older itinerary entries stored the place as "zone"
                    place: String(val.place || val.zone || '').trim(),
                    activity: activityText(val)
                });
            });
            entries.sort((a, b) => a.date.localeCompare(b.date));

            const kraList = IS_FIELD && kraSnap ? normalizeList(kraSnap.val()) : [];
            const r = IS_FIELD && refSnap ? (refSnap.val() || {}) : {};
            const reflection = { praising: normalizeList(r.praising), prayer: normalizeList(r.prayer) };

            model = buildModel(entries, kraList, reflection);
        } catch (err) {
            if (view.key !== key) return;
            console.error('Report load failed:', err);
            view.error = true;
        }

        view.loaded = true;
        render();
    }

    /* =====================================================
       Web preview
       ===================================================== */
    function brandRow(m) {
        const wrap = el('div', 'rpt-brand');
        const img = el('img', 'rpt-logo');
        img.src = LOGO;
        img.alt = '';
        wrap.append(img, el('span', 'rpt-brand-text', orgLine(m)));
        const td = el('td');
        td.colSpan = N;
        td.append(wrap);
        return tr('', [td]);
    }

    function titleRow(m) {
        return tr('rpt-title', [cell(m.title, N)]);
    }

    function infoRow(m) {
        const td = el('td');
        td.colSpan = N;

        const grid = el('div', 'rpt-info-inner');
        const left = el('div');
        const right = el('div');
        const row = (label, value) => {
            const r = el('div', 'rpt-info-row');
            r.append(el('div', 'rpt-info-label', label), el('div', 'rpt-info-value', value));
            return r;
        };

        left.append(row('NAME', m.name), row('REGION', m.region));
        right.append(row('BASE', m.base), row('MONTH', `${m.monthName}, ${m.year}`));

        grid.append(left, right);
        td.append(grid);
        return tr('rpt-info', [td]);
    }

    function kraRows(m) {
        const head = tr('rpt-kra-head', [cell('KRA (KEY RESULTING AREA) OBJECTIVES:', N)]);
        const td = el('td');
        td.colSpan = N;

        const box = el('div', 'kra-plain');
        m.kraList.forEach((t, i) => {
            const item = el('div', 'kra-item');
            item.append(
                el('span', 'kra-num', `${i + 1}.`),
                el('div', 'kra-text', kraLines(t).join('\n'))
            );
            box.append(item);
        });

        td.append(box);
        return [head, tr('rpt-kra-body', [td])];
    }

    function mainHeadRow() {
        const r = el('tr');
        COLS.forEach((c) => {
            const th = el('th', '', c.head);
            th.style.width = c.pct;
            r.append(th);
        });
        return r;
    }

    function mainRows(groups) {
        return groups.map((g) => tr('', COLS.map((c) => {
            const cls = c.key === 'act' ? 'rpt-activity' : (c.key === 'date' || c.key === 'kra' ? 'nw' : '');
            const td = el('td', cls, cellText(g, c.key));
            if (c.align === 'left') td.style.textAlign = 'left';
            if (c.key === 'act') td.style.whiteSpace = 'pre-line';
            return td;
        })));
    }

    function otherRows(list) {
        const span = N - 2;
        const head = tr('rpt-sec-head', [cell('Other than KRA', N)]);

        const hdr = el('tr');
        hdr.append(el('th', '', 'DATE'), el('th', '', 'PLACE AND PURPOSE'));
        const particulars = el('th', '', 'PARTICULARS, PROBLEMS AND HIGHLIGHTS');
        particulars.colSpan = span;
        hdr.append(particulars);

        const rows = list.map((e) => {
            const place = el('td', '', e.place);
            place.style.textAlign = 'center';   
            const act = el('td', 'rpt-activity', e.activity || '—');
            act.colSpan = span;
            act.style.textAlign = 'left';
            act.style.whiteSpace = 'pre-line';
            return tr('', [cell(String(Number(e.date.slice(8, 10))), 1, 'nw'), place, act]);
        });

        return [head, hdr, ...rows];
    }

    // Praise and prayer: shows only the lists that have points
    function reflectRow(m) {
        const blocks = [];
        if (m.praising.length) blocks.push(['PRAISING POINTS:', m.praising]);
        if (m.prayer.length) blocks.push(['PRAYER POINTS:', m.prayer]);

        const td = el('td');
        td.colSpan = N;
        const wrap = el('div', 'rpt-reflect' + (blocks.length === 1 ? ' one' : ''));
        blocks.forEach(([title, items]) => {
            const c = el('div', 'rpt-reflect-col');
            c.append(el('div', 'rpt-reflect-title', title));
            const list = el('ol', 'rpt-reflect-list');
            items.forEach((t) => list.append(el('li', '', t)));
            c.append(list);
            wrap.append(c);
        });
        td.append(wrap);
        return tr('', [td]);
    }

    // Copy to (bottom left) and Submitted by (bottom right)
    function footerNode(f) {
        const left = el('div', 'sign-left');
        left.append(el('p', 'sign-label', 'Copy to,'));
        f.copyTo.forEach((line) => left.append(el('p', 'sign-line', line)));

        const right = el('div', 'sign-right');
        right.append(el('p', 'sign-label', 'Submitted by,'));
        if (f.signatureUrl) {
            const img = el('img', 'sign-img');
            img.src = f.signatureUrl;
            img.alt = 'Signature';
            right.append(img);
        } else {
            right.append(el('div', 'sign-space'));
        }
        right.append(el('p', 'sign-name', f.name));
        if (f.role) right.append(el('p', 'sign-line', f.role));

        const wrap = el('div', 'sign-row');
        wrap.append(left, right);
        return wrap;
    }

    function renderPaper(m) {
        const thead = el('thead');
        thead.append(brandRow(m), titleRow(m), infoRow(m));

        const tbody = el('tbody');
        if (IS_FIELD && m.kraList.length) tbody.append(...kraRows(m));
        tbody.append(mainHeadRow(), ...mainRows(m.mainGroups));
        if (m.otherEntries.length) tbody.append(...otherRows(m.otherEntries));
        if (hasReflection(m)) tbody.append(reflectRow(m));

        const table = el('table', 'rpt');
        table.append(thead, tbody);

        const scroll = el('div', 'rpt-scroll');
        scroll.append(table);

        $('paper').replaceChildren(scroll, footerNode(m.footer));
    }

    /* ---------- Render state ---------- */
    function render() {
        const authed = Boolean(view.session);
        const hasData = Boolean(
            authed && requestOk && view.loaded && !view.error && model &&
            (model.mainGroups.length > 0 || model.otherEntries.length > 0)
        );
        const noData = authed && requestOk && view.loaded && !view.error && !hasData;

        $('loadState').hidden = !(authed && requestOk && !view.loaded);
        $('errorState').hidden = !(authed && (!requestOk || view.error));
        $('errorText').textContent = requestOk
            ? 'Could not load the report. Check your connection.'
            : 'The report details are missing. Please generate the report again.';
        $('retryBtn').hidden = !requestOk;
        $('noData').hidden = !noData;
        $('paper').hidden = !hasData;
        $('exportBar').hidden = !hasData;

        if (hasData) {
            renderPaper(model);
        } else {
            $('paper').replaceChildren();
            closeSheet();
        }
    }

    /* ---------- Export sheet ---------- */
    function openSheet() {
        $('exportSheet').classList.add('show');
        $('exportSheet').setAttribute('aria-hidden', 'false');
        $('sheetScrim').classList.add('show');
    }

    function closeSheet() {
        $('exportSheet').classList.remove('show');
        $('exportSheet').setAttribute('aria-hidden', 'true');
        $('sheetScrim').classList.remove('show');
    }

    function saveBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = el('a');
        a.href = url;
        a.download = filename;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /* =====================================================
       PDF
       ===================================================== */
    function drawFooterPdf(doc, f, sig, startY) {
        const LEFT_X = 14;
        const RIGHT_EDGE = 196; // A4 width (210) minus the 14 mm margin

        doc.setFontSize(10);

        // The Submitted by block is aligned so its widest line ends at the right margin
        doc.setFont('times', 'bold');
        const labelW = doc.getTextWidth('Submitted by,');
        const nameW = doc.getTextWidth(f.name);
        doc.setFont('times', 'normal');
        const roleW = f.role ? doc.getTextWidth(f.role) : 0;
        const sigH = sig ? Math.min(SIG_MAX_H_MM, (SIG_W_MM * sig.h) / sig.w) : 0;
        const blockW = Math.max(labelW, nameW, roleW, sig ? SIG_W_MM : 0);
        const RIGHT_X = RIGHT_EDGE - blockW;

        const blockH = Math.max(
            6 + f.copyTo.length * 5,
            6 + (sig ? sigH + 2 : 8) + 6 + (f.role ? 5 : 0)
        );

        const pageH = doc.internal.pageSize.getHeight();
        let y = startY + 10;
        if (y + blockH > pageH - 14) {
            doc.addPage();
            y = 16;
        }

        doc.setTextColor(0, 0, 0);
        doc.setFont('times', 'bold');
        doc.text('Copy to,', LEFT_X, y);
        doc.setFont('times', 'normal');
        f.copyTo.forEach((line, i) => doc.text(line, LEFT_X, y + 6 + i * 5));

        doc.setFont('times', 'bold');
        doc.text('Submitted by,', RIGHT_X, y);
        let ry = y + 2;
        if (sig) {
            doc.addImage(sig.dataUrl, sig.fmt, RIGHT_X - 6, ry, SIG_W_MM, sigH);
            ry += sigH + 2;
        } else {
            ry += 8;
        }
        doc.text(f.name, RIGHT_X, ry + 4);
        ry += 6;

        if (f.role) {
            doc.setFont('times', 'normal');
            doc.text(f.role, RIGHT_X, ry + 4);
        }
    }

    // KRA objectives as plain text (no table), with the outer number once and sub-lines indented
    function drawKraPdf(doc, m, startY) {
        const LEFT = 14;
        const WIDTH = 182;
        const NUM_W = 8;
        const TEXT_W = WIDTH - NUM_W - 2;
        const PAGE_LIMIT = 280;
        let y = startY;

        // Light heading bar
        doc.setFillColor(238, 242, 241);
        doc.setDrawColor(68, 68, 68);
        doc.rect(LEFT, y, WIDTH, 7, 'FD');
        doc.setFont('times', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(0, 0, 0);
        doc.text('KRA (KEY RESULTING AREA) OBJECTIVES:', LEFT + 2, y + 4.8);
        y += 12;

        m.kraList.forEach((t, i) => {
            const lines = kraLines(t).flatMap((line) => doc.splitTextToSize(line, TEXT_W));
            const blockH = Math.max(1, lines.length) * 5;
            if (y + blockH > PAGE_LIMIT) {
                doc.addPage();
                y = 16;
            }

            doc.setFont('times', 'bold');
            doc.setFontSize(10);
            doc.text(`${i + 1}.`, LEFT + 1, y);

            doc.setFont('times', 'normal');
            lines.forEach((line) => {
                doc.text(line, LEFT + NUM_W, y);
                y += 5;
            });
            y += 2;
        });

        return y;
    }

    function exportPdf(m, logo, sig) {
        if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF not loaded');

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        doc.setFont('times', 'normal');
        doc.setFontSize(9);

        const base = {
            font: 'times', fontSize: 9, lineColor: [68, 68, 68], lineWidth: 0.2,
            cellPadding: 2, valign: 'middle', textColor: [0, 0, 0]
        };
        const headStyle = {
            fillColor: [242, 242, 242], textColor: [0, 0, 0],
            fontStyle: 'bold', lineColor: [68, 68, 68], lineWidth: 0.2, halign: 'center'
        };
        // Light section heading with black text (KRA objectives and Other than KRA)
        const sectionHead = {
            fillColor: [238, 242, 241], textColor: [0, 0, 0], fontStyle: 'bold', halign: 'left'
        };

        // Brand line: logo beside the organisation text, centred
        const brand = orgLine(m);
        doc.setFont('times', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(0, 0, 0);
        const gap = 3;
        const total = (logo ? LOGO_MM + gap : 0) + doc.getTextWidth(brand);
        const x0 = (210 - total) / 2;
        let y = 12;
        if (logo) doc.addImage(logo.dataUrl, logo.fmt, x0, y + 2, LOGO_MM, LOGO_MM);
        doc.text(brand, x0 + (logo ? LOGO_MM + gap : 0), y + 8, { baseline: 'middle' });
        y += 16;

        doc.setFont('times', 'bold');
        doc.setFontSize(15);
        doc.setTextColor(7, 94, 84);
        doc.text(m.title, 105, y + 5, { align: 'center' });
        y += 12;
        doc.setTextColor(0, 0, 0);

        // Info block
        doc.autoTable({
            startY: y,
            body: [
                ['NAME', m.name, 'BASE', m.base],
                ['REGION', m.region, 'MONTH', `${m.monthName}, ${m.year}`]
            ],
            theme: 'grid',
            margin: { left: 14, right: 14 },
            tableWidth: 182,
            styles: base,
            columnStyles: {
                0: { fontStyle: 'bold', fillColor: [248, 248, 248], cellWidth: 25 },
                1: { cellWidth: 66 },
                2: { fontStyle: 'bold', fillColor: [248, 248, 248], cellWidth: 25 },
                3: { cellWidth: 66 }
            }
        });
        y = doc.lastAutoTable.finalY + 2;

        // KRA objectives (field report only, only when set)
        // if (IS_FIELD && m.kraList.length) {
        //     doc.autoTable({
        //         startY: y,
        //         head: [[{ content: 'KRA (KEY RESULTING AREA) OBJECTIVES:', colSpan: N, styles: sectionHead }]],
        //         body: m.kraList.map((t, i) => [{
        //             content: `${i + 1}. ${t}`,
        //             colSpan: N,
        //             styles: { halign: 'left', textColor: [0, 0, 0] }
        //         }]),
        //         theme: 'grid',
        //         margin: { left: 14, right: 14 },
        //         styles: { ...base, valign: 'top' }
        //     });
        //     y = doc.lastAutoTable.finalY + 2;
        // }
        // KRA objectives (field report only, only when set)
    if (IS_FIELD && m.kraList.length) {
        y = drawKraPdf(doc, m, y) + 2;
    }

        // Main table
        doc.autoTable({
            startY: y,
            head: [COLS.map((c) => ({ content: c.head }))],
            body: m.mainGroups.map((g) => COLS.map((c) => ({
                content: cellText(g, c.key),
                styles: { halign: c.align }
            }))),
            theme: 'grid',
            margin: { left: 14, right: 14 },
            styles: base,
            headStyles: headStyle,
            columnStyles: Object.fromEntries(COLS.map((c, i) => [i, { cellWidth: c.mm, halign: c.align }])),
            rowPageBreak: 'avoid'
        });
        y = doc.lastAutoTable.finalY + 2;

        // Other than KRA (field report only, only when there are entries)
        if (m.otherEntries.length) {
            doc.autoTable({
                startY: y,
                head: [
                    [{ content: 'Other than KRA', colSpan: 3, styles: sectionHead }],
                    [{ content: 'DATE' }, { content: 'PLACE AND PURPOSE' }, { content: 'PARTICULARS, PROBLEMS AND HIGHLIGHTS' }]
                ],
                body: m.otherEntries.map((e) => [
                    { content: String(Number(e.date.slice(8, 10))), styles: { halign: 'center' } },
                    { content: e.place, styles: { halign: 'center' } },
                    { content: e.activity || '—', styles: { halign: 'left' } }
                ]),
                theme: 'grid',
                margin: { left: 14, right: 14 },
                styles: base,
                headStyles: headStyle,
                columnStyles: {
                    0: { cellWidth: OTHER.mm[0] },
                    1: { cellWidth: OTHER.mm[1] },
                    2: { cellWidth: OTHER.mm[2] }
                },
                rowPageBreak: 'avoid'
            });
            y = doc.lastAutoTable.finalY + 2;
        }

        // Praise and prayer (only the lists that have points)
        if (hasReflection(m)) {
            const blocks = [];
            if (m.praising.length) blocks.push(`PRAISING POINTS:\n${numbered(m.praising)}`);
            if (m.prayer.length) blocks.push(`PRAYER POINTS:\n${numbered(m.prayer)}`);
            const w = blocks.length === 2 ? 91 : 182;

            doc.autoTable({
                startY: y,
                body: [blocks.map((text) => ({ content: text, styles: { halign: 'left', valign: 'top' } }))],
                theme: 'grid',
                margin: { left: 14, right: 14 },
                styles: { ...base, cellPadding: 3, valign: 'top' },
                columnStyles: Object.fromEntries(blocks.map((_, i) => [i, { cellWidth: w }]))
            });
            y = doc.lastAutoTable.finalY + 2;
        }

        drawFooterPdf(doc, m.footer, sig, y);
        doc.save(`${fileBase(m)}.pdf`);
    }

    /* =====================================================
       Excel
       ===================================================== */
    function exportExcel(m) {
        if (typeof XLSX === 'undefined') throw new Error('SheetJS not loaded');

        const aoa = [];
        const merges = [];

        // A row of text merged across all columns
        const wide = (text) => {
            const r = aoa.length;
            aoa.push([text]);
            merges.push({ s: { r, c: 0 }, e: { r, c: N - 1 } });
        };

        wide(orgLine(m));
        wide(m.title);
        wide(`NAME: ${m.name}   |   BASE: ${m.base}   |   REGION: ${m.region}   |   MONTH: ${m.monthName}, ${m.year}`);
        aoa.push([]);

        if (IS_FIELD && m.kraList.length) {
            wide('KRA (KEY RESULTING AREA) OBJECTIVES:');
            m.kraList.forEach((t, i) => wide(`${i + 1}. ${kraLines(t).join(' / ')}`));
            aoa.push([]);
        }

        aoa.push(COLS.map((c) => c.head));
        m.mainGroups.forEach((g) => aoa.push(COLS.map((c) => cellText(g, c.key))));

        if (m.otherEntries.length) {
            aoa.push([]);
            wide('Other than KRA');
            const hr = aoa.length;
            aoa.push(padRow(['DATE', 'PLACE AND PURPOSE', 'PARTICULARS, PROBLEMS AND HIGHLIGHTS']));
            merges.push({ s: { r: hr, c: 2 }, e: { r: hr, c: N - 1 } });
            m.otherEntries.forEach((e) => {
                const r = aoa.length;
                aoa.push(padRow([String(Number(e.date.slice(8, 10))), e.place, e.activity || '']));
                merges.push({ s: { r, c: 2 }, e: { r, c: N - 1 } });
            });
        }

        if (hasReflection(m)) {
            aoa.push([]);
            if (m.praising.length) {
                wide('PRAISING POINTS:');
                m.praising.forEach((t, i) => wide(`${i + 1}. ${t}`));
            }
            if (m.prayer.length) {
                wide('PRAYER POINTS:');
                m.prayer.forEach((t, i) => wide(`${i + 1}. ${t}`));
            }
        }

        // Copy to (left, first two columns) and Submitted by (right)
        const f = m.footer;
        const left = ['Copy to,', ...f.copyTo];
        const right = ['Submitted by,', '', f.name, ...(f.role ? [f.role] : [])];
        aoa.push([]);
        for (let i = 0; i < Math.max(left.length, right.length); i++) {
            const r = aoa.length;
            aoa.push(padRow([left[i] || '', '', right[i] ? EXCEL_SIGN_INDENT + right[i] : '']));
            merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
            if (N > 3) merges.push({ s: { r, c: 2 }, e: { r, c: N - 1 } });
        }

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!merges'] = merges;
        ws['!cols'] = COLS.map((c) => ({ wch: c.xl }));
        ws['!rows'] = aoa.map((_, i) => (i < 3 ? { hpt: 26 } : {}));

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, KIND.sheet);
        XLSX.writeFile(wb, `${fileBase(m)}.xlsx`);
    }

    /* =====================================================
       Word (.docx)
       ===================================================== */
    function docxRun(text, o = {}) {
        const rPr = '<w:rPr>' +
            '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>' +
            (o.b ? '<w:b/>' : '') +
            (o.color ? `<w:color w:val="${o.color}"/>` : '') +
            `<w:sz w:val="${o.sz || 20}"/><w:szCs w:val="${o.sz || 20}"/>` +
            '</w:rPr>';
        return `<w:r>${rPr}<w:t xml:space="preserve">${escapeHtml(text)}</w:t></w:r>`;
    }

    function docxPara(runs, o = {}) {
        let ind = '';
        if (o.hang) ind = '<w:ind w:left="284" w:hanging="284"/>';
        else if (o.ind) ind = `<w:ind w:left="${o.ind}"/>`;

        let jc = '';
        if (o.center) jc = '<w:jc w:val="center"/>';
        else if (o.right) jc = '<w:jc w:val="right"/>';
        else if (o.left) jc = '<w:jc w:val="left"/>';

        return '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/>' + ind + jc +
            '</w:pPr>' + runs + '</w:p>';
    }

    // One paragraph per line of text (keeps line breaks in activities)
    function textParas(text, align) {
        return String(text || '').split('\n')
            .map((line) => docxPara(docxRun(line), align === 'center' ? { center: true } : { left: true }))
            .join('');
    }

    function docxCell(width, paragraphs, o = {}) {
        let tcPr = `<w:tcW w:w="${width}" w:type="dxa"/>`;
        if (o.span) tcPr += `<w:gridSpan w:val="${o.span}"/>`;
        if (o.shade) tcPr += '<w:shd w:val="clear" w:color="auto" w:fill="EEF2F1"/>';
        if (o.shadeHead) tcPr += '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>';
        tcPr += `<w:vAlign w:val="${o.vAlign || 'center'}"/>`;
        return `<w:tc><w:tcPr>${tcPr}</w:tcPr>${paragraphs}</w:tc>`;
    }

    function docxRow(cells, o = {}) {
        const trPr = o.height ? `<w:trPr><w:trHeight w:val="${o.height}" w:hRule="atLeast"/></w:trPr>` : '';
        return `<w:tr>${trPr}${cells.join('')}</w:tr>`;
    }

    function docxImage(rId, cx, cy, id, name) {
        return '<w:r><w:drawing>' +
            '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
            `<wp:extent cx="${cx}" cy="${cy}"/>` +
            `<wp:docPr id="${id}" name="${name}"/>` +
            '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
            '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
            '<pic:pic><pic:nvPicPr>' +
            `<pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
            `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
            `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
            '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    }

    function buildTable(rowsXml, widths) {
        const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="444444"/>`;
        return '<w:tbl><w:tblPr>' +
            `<w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>` +
            '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('') + '</w:tblBorders>' +
            '<w:tblLayout w:type="fixed"/></w:tblPr>' +
            `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
            rowsXml.join('') + '</w:tbl>';
    }

    function docxFooter(f, sig, textW) {
        // Right column is a fixed width, flush to the right margin
        const rightW = 3800;
        const leftW = textW - rightW;

        const left = [docxPara(docxRun('Copy to,', { b: true }))]
            .concat(f.copyTo.map((line) => docxPara(docxRun(line))));

        const right = [docxPara(docxRun('Submitted by,', { b: true }), { right: true })];
        if (sig) {
            const { cx, cy } = sigEmu(sig);
            right.push('<w:p><w:pPr><w:spacing w:before="0" w:after="0"/><w:ind w:right="300"/><w:jc w:val="right"/></w:pPr>' +
                docxImage('rIdSig', cx, cy, 2, 'Signature') + '</w:p>');
        } else {
            right.push(docxPara('', { right: true }));
        }
        right.push(docxPara(docxRun(f.name, { b: true }), { right: true }));
        if (f.role) right.push(docxPara(docxRun(f.role), { right: true }));

        const none = '<w:tblBorders>' +
            ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((s) => `<w:${s} w:val="nil"/>`).join('') +
            '</w:tblBorders>';

        return '<w:tbl><w:tblPr>' +
            `<w:tblW w:w="${textW}" w:type="dxa"/>` + none +
            '<w:tblLayout w:type="fixed"/></w:tblPr>' +
            `<w:tblGrid><w:gridCol w:w="${leftW}"/><w:gridCol w:w="${rightW}"/></w:tblGrid>` +
            '<w:tr>' +
            docxCell(leftW, left.join(''), { vAlign: 'top' }) +
            docxCell(rightW, right.join(''), { vAlign: 'top' }) +
            '</w:tr></w:tbl>';
    }

    function reflParas(title, items) {
        return docxPara(docxRun(title, { b: true, color: '075E54' }), { left: true }) +
            items.map((t, i) => docxPara(docxRun(`${i + 1}. ${t}`), { left: true, hang: true })).join('');
    }

    function kraXml(m) {
    if (!(IS_FIELD && m.kraList.length)) return '';
    const MAIN_W = COLS.reduce((a, c) => a + c.tw, 0);

    const heading = buildTable(
        [docxRow([docxCell(MAIN_W,
            docxPara(docxRun('KRA (KEY RESULTING AREA) OBJECTIVES:', { b: true }), { left: true }),
            { shade: true })])],
        [MAIN_W]
    );

    const items = m.kraList.map((t, i) => {
        const lines = kraLines(t);
        return lines.map((line, k) => k === 0
            ? docxPara(docxRun(`${i + 1}.`, { b: true }) + '<w:r><w:tab/></w:r>' + docxRun(line), { hang: true })
            : docxPara(docxRun(line), { ind: 284 })
        ).join('');
    }).join(docxPara(''));

    return docxPara('') + heading + docxPara('') + items;
    }

    function buildDocumentXml(m, logo, sig) {
        const TW = COLS.map((c) => c.tw);
        const MAIN_W = TW.reduce((a, b) => a + b, 0);

        const headRows = [];
        const brandRuns = (logo ? docxImage('rIdLogo', LOGO_EMU, LOGO_EMU, 1, 'UESI Logo') + docxRun('  ') : '') +
            docxRun(orgLine(m), { b: true, sz: 24 });
        headRows.push(docxRow([docxCell(MAIN_W, docxPara(brandRuns, { center: true }), { span: N })], { height: 900 }));
        headRows.push(docxRow([docxCell(MAIN_W,
            docxPara(docxRun(m.title, { b: true, sz: 30, color: '075E54' }), { center: true }), { span: N })]));
        headRows.push(docxRow([docxCell(MAIN_W, docxPara(
            docxRun('NAME: ', { b: true }) + docxRun(m.name) +
            docxRun('      BASE: ', { b: true }) + docxRun(m.base),
            { left: true }
        ), { span: N })]));
        headRows.push(docxRow([docxCell(MAIN_W, docxPara(
            docxRun('REGION: ', { b: true }) + docxRun(m.region) +
            docxRun('      MONTH: ', { b: true }) + docxRun(`${m.monthName}, ${m.year}`),
            { left: true }
        ), { span: N })]));

        const rows = [];
        rows.push(docxRow(COLS.map((c, i) =>
            docxCell(TW[i], docxPara(docxRun(c.head, { b: true }), { center: true }), { shadeHead: true })
        )));
        m.mainGroups.forEach((g) => rows.push(docxRow(COLS.map((c, i) =>
            docxCell(TW[i], textParas(cellText(g, c.key), c.align), { vAlign: 'top' })
        ))));

        let extra = '';

        if (m.otherEntries.length) {
            const oW = OTHER.tw.reduce((a, b) => a + b, 0);
            const oRows = [];
            oRows.push(docxRow([docxCell(oW,
                docxPara(docxRun('Other than KRA', { b: true }), { left: true }),
                { span: 3, shade: true })]));
            oRows.push(docxRow(['DATE', 'PLACE AND PURPOSE', 'PARTICULARS, PROBLEMS AND HIGHLIGHTS'].map((h, i) =>
                docxCell(OTHER.tw[i], docxPara(docxRun(h, { b: true }), { center: true }), { shadeHead: true })
            )));
            m.otherEntries.forEach((e) => oRows.push(docxRow([
                docxCell(OTHER.tw[0], textParas(String(Number(e.date.slice(8, 10))), 'center'), { vAlign: 'top' }),
                docxCell(OTHER.tw[1], textParas(e.place, 'center'), { vAlign: 'top' }),
                docxCell(OTHER.tw[2], textParas(e.activity || '—', 'left'), { vAlign: 'top' })
            ])));
            extra += docxPara('') + buildTable(oRows, OTHER.tw);
        }

        if (hasReflection(m)) {
            const blocks = [];
            if (m.praising.length) blocks.push(['PRAISING POINTS:', m.praising]);
            if (m.prayer.length) blocks.push(['PRAYER POINTS:', m.prayer]);
            const half = Math.floor(MAIN_W / 2);
            const widths = blocks.length === 2 ? [half, MAIN_W - half] : [MAIN_W];
            const cells = blocks.map(([title, items], i) =>
                docxCell(widths[i], reflParas(title, items), { vAlign: 'top' }));
            extra += docxPara('') + buildTable([docxRow(cells)], widths);
        }

        const footer = docxPara('') + docxFooter(m.footer, sig, MAIN_W);

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<w:document ' +
            'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
            'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
            'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
            '<w:body>' +
            buildTable(headRows, TW) +
            kraXml(m) +
            docxPara('') +
            buildTable(rows, TW) +
            extra +
            footer +
            docxPara('') +
            '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
            '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>' +
            '</w:sectPr></w:body></w:document>';
    }

    async function exportDocx(m, logo, sig) {
        if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded');

        const zip = new JSZip();
        const logoExt = logo ? logo.ext : 'png';
        const sigExt = sig ? sig.ext : 'png';

        zip.file('[Content_Types].xml',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
            '<Default Extension="xml" ContentType="application/xml"/>' +
            '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
            '<Default Extension="png" ContentType="image/png"/>' +
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
            '</Types>');

        zip.file('_rels/.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
            '</Relationships>');

        const rels = [];
        if (logo) rels.push(`<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.${logoExt}"/>`);
        if (sig) rels.push(`<Relationship Id="rIdSig" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/signature.${sigExt}"/>`);

        zip.file('word/_rels/document.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            rels.join('') + '</Relationships>');

        zip.file('word/document.xml', buildDocumentXml(m, logo, sig));
        if (logo) zip.file(`word/media/logo.${logoExt}`, logo.base64, { base64: true });
        if (sig) zip.file(`word/media/signature.${sigExt}`, sig.base64, { base64: true });

        const blob = await zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME, compression: 'DEFLATE' });
        saveBlob(blob, `${fileBase(m)}.docx`);
    }

    /* ---------- Export runner ---------- */
    async function runExport(type) {
        if (!model) {
            notify('There is no data to export.', 'info');
            return;
        }

        closeSheet();
        const btn = $('exportBtn');
        setLoading(btn, true, 'Preparing…');

        try {
            const logo = await loadLogo();
            const sig = model.footer.signatureUrl
                ? await imageInfo(model.footer.signatureUrl).catch(() => null)
                : null;

            await new Promise((r) => setTimeout(r, 50)); // lets the spinner paint

            if (type === 'pdf') exportPdf(model, logo, sig);
            if (type === 'excel') exportExcel(model);
            if (type === 'word') await exportDocx(model, logo, sig);
        } catch (err) {
            console.error(`${type} export failed:`, err);
            notify(`Could not create the ${type.toUpperCase()} file. Please try again.`, 'error');
        } finally {
            setLoading(btn, false);
        }
    }

    /* ---------- Auth ---------- */
    function onAuth(session) {
        const body = document.body;
        body.classList.remove('auth-pending', 'is-authed', 'is-guest');
        body.classList.add(session ? 'is-authed' : 'is-guest');

        const key = session ? session.email : null;
        view.session = session;

        if (key === view.key) {
            render();
            return;
        }

        view.key = key;
        view.loaded = false;
        view.error = false;
        model = null;

        if (session && requestOk) load();
        else render();
    }

    /* ---------- Events ---------- */
    $('backBtn').addEventListener('click', () => {
        if (history.length > 1) history.back();
        else location.href = Session.HOME_URL;
    });
    $('loginBtn').addEventListener('click', () => Session.login());
    $('retryBtn').addEventListener('click', () => {
        if (view.session && requestOk) load();
    });
    $('exportBtn').addEventListener('click', openSheet);
    $('sheetScrim').addEventListener('click', closeSheet);
    $('sheetClose').addEventListener('click', closeSheet);
    $('exportSheet').addEventListener('click', (e) => {
        const option = e.target.closest('[data-export]');
        if (option) runExport(option.dataset.export);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSheet();
    });
    window.addEventListener('pageshow', () => setLoading($('exportBtn'), false));

    loadLogo();
    Session.watch(onAuth);
})();