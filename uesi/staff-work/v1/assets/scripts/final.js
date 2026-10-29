// /apps/uesi/staff-work/v1/assets/scripts/final.js
(() => {
    'use strict';

    const { $, Session, notify, setLoading } = window.UI;

    const KINDS = {
        field: {
            path: 'Field_Report',
            title: 'FIELD STAFF REPORT',
            sheet: 'Field Report',
            label: 'Field Report',
            isField: true,
            dayHead: 'Date(s)',
            midHead: 'KRA'
        },
        itinerary: {
            path: 'Itinerary_Form',
            title: 'FIELD STAFF ITINERARY',
            sheet: 'Itinerary',
            label: 'Itinerary',
            isField: false,
            dayHead: 'DATE(S)',
            midHead: 'PLACE'
        }
    };
    const kind = KINDS[document.body.dataset.kind] || KINDS.field;
    const isItin = !kind.isField;

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

    // Column widths for the main table: [date, middle, activities]
    const WIDTHS = {
        field: { pct: ['12%', '8%', '80%'], mm: [28, 18, 136], tw: [1600, 1000, 7866] },
        itinerary: { pct: ['14%', '22%', '64%'], mm: [24, 40, 118], tw: [1500, 2300, 6666] }
    };
    const W = isItin ? WIDTHS.itinerary : WIDTHS.field;
    const SEC12_MM = [22, 48, 112];
    const SEC12_TW = [1200, 2800, 6466];

    const LOGO_MM = 12;
    const LOGO_EMU = 548640;
    const SIG_W_MM = 40;
    const SIG_MAX_H_MM = 20;
    const SIG_W_EMU = 1463040;
    const SIG_MAX_H_EMU = 548640;

    if (!firebase.apps.length) {
        firebase.initializeApp({
            apiKey: '0AzyPiDT3wSi6WAuNX7YzbyJcvUgV0nyoxMwahn0',
            authDomain: 'uesi-ap-default-rtdb.firebaseio.com',
            databaseURL: 'https://uesi-ap-default-rtdb.firebaseio.com',
            projectId: 'uesi-ap'
        });
    }
    const db = firebase.database();

    /* ---------- Request ---------- */
    const params = new URLSearchParams(location.search);
    const request = {
        name: (params.get('name') || '').trim(),
        email: (params.get('email') || '').trim(),
        base: (params.get('base') || '').trim(),
        region: (params.get('region') || '').trim(),
        state: (params.get('state') || '').trim(),
        month: Number(params.get('month')),
        year: Number(params.get('year'))
    };
    const requestOk = Boolean(
        request.base && request.region && (!isItin || request.state) &&
        Number.isInteger(request.month) && request.month >= 1 && request.month <= 12 &&
        Number.isInteger(request.year) && request.year >= 2000 && request.year <= 2100
    );

    /* ---------- State ---------- */
    const view = { key: undefined, session: null, loaded: false, error: false };
    let model = null;

    /* ---------- Helpers ---------- */
    const pad = (n) => String(n).padStart(2, '0');
    const fmtDate = (ymd) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
    const dayOfWeek = (ymd) =>
        new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
    const safeName = (s) => s.replace(/[\\/:*?"<>|]+/g, '').trim();
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
    const storageGet = (key) => {
        try { return localStorage.getItem(key); } catch (_) { return null; }
    };

    const orgLine = (m) => (isItin ? `${ORG} - ${m.state.toUpperCase()}` : ORG);
    const midValue = (g) => (isItin ? g.place : String(g.kra));
    const dayText = (dates) => dates.map((d) => String(Number(d.slice(8, 10)))).join(', ');
    const fileBase = (m) => safeName(`${m.name} ${kind.label} - ${m.monthName} ${m.year}`);
    const sameKra = (a, b) => (a.kra ?? null) === (b.kra ?? null);
    const dayGap = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);

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

    // Accepts the saved array of points, or plain text with one point per line
    function toPoints(value) {
        if (Array.isArray(value)) return value.map((p) => String(p).trim()).filter(Boolean);
        if (typeof value === 'string') {
            return value
                .split('\n')
                .map((line) => line.trim().replace(/^\d+[.)]\s*/, '').replace(/^[*\-•]\s*/, ''))
                .filter(Boolean);
        }
        return [];
    }

    // One text value for the activity column, numbered when there is more than one point
    function activityText(val) {
        if (typeof val.activity === 'string' && val.activity.trim()) return val.activity.trim();
        const pts = toPoints(val.purpose);
        if (pts.length > 1) return pts.map((p, i) => `${i + 1}. ${p}`).join('\n');
        return pts[0] || '';
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

    /* ---------- Grouping: same date-consecutive rows with the same details share one row ---------- */
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

    function buildModel(entries, kraObjectives, reflection) {
        const monthName = MONTHS[request.month - 1];
        const mainEntries = kind.isField ? entries.filter((e) => e.kra !== 0) : entries;
        const otherEntries = kind.isField ? entries.filter((e) => e.kra === 0) : [];

        return {
            title: `${kind.title} - ${monthName.toUpperCase()} ${request.year}`,
            monthName,
            year: request.year,
            state: request.state,
            region: request.region,
            base: request.base,
            name: request.name || view.session.name,
            mainGroups: groupConsecutive(mainEntries),
            otherEntries,
            kraObjectives,
            praising: reflection.praising,
            prayer: reflection.prayer,
            footer: isItin ? readFooter() : null
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
            const [entriesSnap, kraSnap, refSnap] = await withTimeout(
                Promise.all([
                    db.ref(`${base}/${kind.path}/${request.year}/${month}`).once('value'),
                    kind.isField ? db.ref(`${base}/KRA_Objectives/${request.year}/${month}`).once('value') : null,
                    kind.isField ? db.ref(`${base}/Monthly_Reflection/${request.year}/${month}`).once('value') : null
                ]),
                LOAD_TIMEOUT_MS
            );

            if (view.key !== key) return;

            const entries = [];
            entriesSnap.forEach((child) => {
                const date = child.key;
                const val = child.val();
                if (!DATE_RE.test(date) || !val || typeof val !== 'object') return;
                entries.push({
                    date,
                    day: val.day || dayOfWeek(date),
                    kra: kind.isField ? Number(val.kra ?? 0) : null,
                    // The itinerary form saves the place as "zone"
                    place: String(val.place || val.zone || '').trim(),
                    activity: activityText(val)
                });
            });
            entries.sort((a, b) => a.date.localeCompare(b.date));

            const kraObjectives = [];
            if (kind.isField && kraSnap) {
                const k = kraSnap.val() || {};
                for (let i = 1; i <= 5; i++) {
                    const text = String(k[String(i)] || '').trim();
                    if (text) kraObjectives.push({ n: i, text });
                }
            }

            let reflection = { praising: [], prayer: [] };
            if (kind.isField && refSnap) {
                const r = refSnap.val() || {};
                reflection = {
                    praising: Array.isArray(r.praising) ? r.praising.filter(Boolean).map(String) : [],
                    prayer: Array.isArray(r.prayer) ? r.prayer.filter(Boolean).map(String) : []
                };
            }

            model = buildModel(entries, kraObjectives, reflection);
        } catch (err) {
            if (view.key !== key) return;
            console.error('Report load failed:', err);
            view.error = true;
        }

        view.loaded = true;
        render();
    }

    /* =====================================================
       Preview
       ===================================================== */
    function brandRow(m) {
        const wrap = el('div', 'rpt-brand');
        const img = el('img', 'rpt-logo');
        img.src = LOGO;
        img.alt = '';
        wrap.append(img, el('span', 'rpt-brand-text', orgLine(m)));
        const td = el('td');
        td.colSpan = 3;
        td.append(wrap);
        return tr('', [td]);
    }

    function docTitleRow(m) {
        return tr('rpt-title', [cell(m.title, 3)]);
    }

    function infoRow(m) {
        const td = el('td');
        td.colSpan = 3;

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

    function kraObjectivesRow(m) {
        const head = tr('rpt-kra-head', [cell('KRA (KEY RESULTING AREA) OBJECTIVES:', 3)]);

        const list = el('ol', 'rpt-kra-list');
        if (m.kraObjectives.length === 0) {
            list.append(el('li', '', 'No KRA objectives were set for this month.'));
        } else {
            m.kraObjectives.forEach((k) => list.append(el('li', '', k.text)));
        }

        const bodyTd = el('td');
        bodyTd.colSpan = 3;
        bodyTd.append(list);

        return [head, tr('rpt-kra-body', [bodyTd])];
    }

    function headMainTable() {
        const r = el('tr');
        [kind.dayHead, kind.midHead, 'ACTIVITIES WITH DETAILS AND PROGRESS'].forEach((text, i) => {
            const th = el('th', '', text);
            th.style.width = W.pct[i];
            r.append(th);
        });
        return r;
    }

    function renderMainRows(groups) {
        return groups.map((g) => {
            const act = cell(g.activity || '—', 1, 'rpt-activity');
            act.style.whiteSpace = 'pre-line';
            act.style.textAlign = 'left';
            return tr('', [
                cell(dayText(g.dates), 1, 'nw'),
                cell(midValue(g), 1, kind.isField ? 'nw' : ''),
                act
            ]);
        });
    }

    function section12Rows(otherEntries) {
        const head = tr('rpt-sec12-head', [cell('12. Other than KRA:', 3)]);

        const thRow = el('tr');
        thRow.append(
            el('th', '', 'DATE'),
            el('th', '', 'PLACE AND PURPOSE'),
            el('th', '', 'PARTICULARS, PROBLEMS AND HIGHLIGHTS')
        );

        const rows = otherEntries.map((e) => {
            const act = cell(e.activity || '—', 1, 'rpt-activity');
            act.style.whiteSpace = 'pre-line';
            act.style.textAlign = 'left';
            return tr('', [cell(String(Number(e.date.slice(8, 10))), 1, 'nw'), cell(e.place), act]);
        });

        return [head, thRow, ...rows];
    }

    function reflectRow(m) {
        const td = el('td');
        td.colSpan = 3;

        const wrap = el('div', 'rpt-reflect');
        const col = (title, items) => {
            const c = el('div', 'rpt-reflect-col');
            c.append(el('div', 'rpt-reflect-title', title));
            const list = el('ol', 'rpt-reflect-list');
            if (items.length === 0) list.append(el('li', '', '—'));
            else items.forEach((t) => list.append(el('li', '', t)));
            c.append(list);
            return c;
        };

        wrap.append(col('PRAISING POINTS:', m.praising), col('PRAYER POINTS:', m.prayer));
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
        const table = el('table', 'rpt');

        const thead = el('thead');
        thead.append(brandRow(m), docTitleRow(m), infoRow(m));

        const tbody = el('tbody');
        if (kind.isField) tbody.append(...kraObjectivesRow(m));
        tbody.append(headMainTable(), ...renderMainRows(m.mainGroups));
        if (kind.isField) tbody.append(...section12Rows(m.otherEntries), reflectRow(m));

        table.append(thead, tbody);

        const scroll = el('div', 'rpt-scroll');
        scroll.append(table);

        const nodes = [scroll];
        if (m.footer) nodes.push(footerNode(m.footer));
        $('paper').replaceChildren(...nodes);
    }

    /* ---------- Render state ---------- */
    function render() {
        const authed = Boolean(view.session);
        const hasData = authed && requestOk && view.loaded && !view.error && model &&
            (model.mainGroups.length > 0 || model.otherEntries.length > 0);
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
        const RIGHT_X = 128;
        const RIGHT_W = 68;

        const sigH = sig ? Math.min(SIG_MAX_H_MM, (SIG_W_MM * sig.h) / sig.w) : 0;
        const roleLines = f.role ? doc.splitTextToSize(f.role, RIGHT_W) : [];

        const blockH = Math.max(
            6 + f.copyTo.length * 5,
            6 + (sig ? sigH + 2 : 8) + 6 + roleLines.length * 5
        );

        const pageH = doc.internal.pageSize.getHeight();
        let y = startY + 10;
        if (y + blockH > pageH - 14) {
            doc.addPage();
            y = 16;
        }

        doc.setTextColor(0, 0, 0);
        doc.setFont('times', 'bold');
        doc.setFontSize(10);
        doc.text('Copy to,', LEFT_X, y);

        // Copy to lines are not split, so each one stays on a single line
        doc.setFont('times', 'normal');
        f.copyTo.forEach((line, i) => doc.text(line, LEFT_X, y + 6 + i * 5));

        doc.setFont('times', 'bold');
        doc.text('Submitted by,', RIGHT_X, y);
        let ry = y + 2;
        if (sig) {
            doc.addImage(sig.dataUrl, sig.fmt, RIGHT_X, ry, SIG_W_MM, sigH);
            ry += sigH + 2;
        } else {
            ry += 8;
        }
        doc.text(f.name, RIGHT_X, ry + 4);
        ry += 6;

        doc.setFont('times', 'normal');
        roleLines.forEach((line) => {
            doc.text(line, RIGHT_X, ry + 4);
            ry += 5;
        });
    }

    function exportPdf(m, logo, sig) {
        if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF not loaded');

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        doc.setFont('times', 'normal');
        doc.setFontSize(9);

        const PAD = 2;
        const MM = W.mm;

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

        if (!isItin) {
            doc.setFont('times', 'bold');
            doc.setFontSize(14);
            doc.setTextColor(7, 94, 84);
            doc.text(`${ORG} — ${m.region}`, 105, y + 4, { align: 'center' });
            y += 8;
        }

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
            styles: {
                font: 'times', fontSize: 9, lineColor: [68, 68, 68], lineWidth: 0.2,
                cellPadding: 2, textColor: [0, 0, 0], valign: 'middle'
            },
            columnStyles: {
                0: { fontStyle: 'bold', fillColor: [248, 248, 248], cellWidth: 25 },
                1: { cellWidth: 66 },
                2: { fontStyle: 'bold', fillColor: [248, 248, 248], cellWidth: 25 },
                3: { cellWidth: 66 }
            }
        });
        y = doc.lastAutoTable.finalY + 2;

        // KRA objectives (field report only)
        if (kind.isField) {
            const objBody = m.kraObjectives.length === 0
                ? [[{ content: 'No KRA objectives were set for this month.', colSpan: 3, styles: { halign: 'left' } }]]
                : m.kraObjectives.map((k) => ([
                    { content: '', styles: { cellWidth: 4, lineWidth: 0, cellPadding: 0 } },
                    { content: `${k.n}.`, styles: { cellWidth: 8, lineWidth: 0, halign: 'right' } },
                    { content: k.text, styles: { halign: 'left', lineWidth: 0 } }
                ]));

            doc.autoTable({
                startY: y,
                head: [[{
                    content: 'KRA (KEY RESULTING AREA) OBJECTIVES:', colSpan: 3,
                    styles: { fontStyle: 'bold', fillColor: [238, 242, 241], textColor: [7, 94, 84], halign: 'left' }
                }]],
                body: objBody,
                theme: 'grid',
                margin: { left: 14, right: 14 },
                styles: { font: 'times', fontSize: 9, lineColor: [68, 68, 68], lineWidth: 0.2, cellPadding: 2, valign: 'top' },
                columnStyles: { 0: { cellWidth: 4 }, 1: { cellWidth: 8 }, 2: { cellWidth: 170 } }
            });
            y = doc.lastAutoTable.finalY + 2;
        }

        // Main table
        doc.autoTable({
            startY: y,
            head: [[
                { content: kind.dayHead, styles: { fontStyle: 'bold', halign: 'center' } },
                { content: kind.midHead, styles: { fontStyle: 'bold', halign: 'center' } },
                { content: 'ACTIVITIES WITH DETAILS AND PROGRESS', styles: { fontStyle: 'bold', halign: 'center' } }
            ]],
            body: m.mainGroups.map((g) => [
                { content: dayText(g.dates), styles: { halign: 'center' } },
                { content: midValue(g), styles: { halign: 'center' } },
                { content: g.activity || '—', styles: { halign: 'left' } }
            ]),
            theme: 'grid',
            margin: { left: 14, right: 14 },
            styles: {
                font: 'times', fontSize: 9, lineColor: [68, 68, 68], lineWidth: 0.2,
                cellPadding: PAD, valign: 'middle', textColor: [0, 0, 0]
            },
            headStyles: {
                fillColor: [242, 242, 242], textColor: [0, 0, 0],
                fontStyle: 'bold', lineColor: [68, 68, 68], lineWidth: 0.2
            },
            columnStyles: {
                0: { cellWidth: MM[0], halign: 'center' },
                1: { cellWidth: MM[1], halign: 'center' },
                2: { cellWidth: MM[2], halign: 'left' }
            },
            rowPageBreak: 'avoid'
        });
        y = doc.lastAutoTable.finalY + 2;

        // Field report only: section 12 and praise / prayer
        if (kind.isField) {
            const secBody = m.otherEntries.map((e) => [
                { content: String(Number(e.date.slice(8, 10))), styles: { halign: 'center' } },
                { content: e.place, styles: { halign: 'left' } },
                { content: e.activity || '—', styles: { halign: 'left' } }
            ]);
            if (secBody.length === 0) {
                secBody.push([
                    { content: '—', styles: { halign: 'center' } },
                    { content: '—', styles: { halign: 'center' } },
                    { content: 'No "Other than KRA" entries for this month.', styles: { halign: 'center', fontStyle: 'italic' } }
                ]);
            }

            doc.autoTable({
                startY: y,
                head: [
                    [{
                        content: '12. Other than KRA:', colSpan: 3,
                        styles: { fillColor: [7, 94, 84], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'left' }
                    }],
                    [
                        { content: 'DATE', styles: { fontStyle: 'bold', halign: 'center' } },
                        { content: 'PLACE AND PURPOSE', styles: { fontStyle: 'bold', halign: 'center' } },
                        { content: 'PARTICULARS, PROBLEMS AND HIGHLIGHTS', styles: { fontStyle: 'bold', halign: 'center' } }
                    ]
                ],
                body: secBody,
                theme: 'grid',
                margin: { left: 14, right: 14 },
                styles: {
                    font: 'times', fontSize: 9, lineColor: [68, 68, 68], lineWidth: 0.2,
                    cellPadding: PAD, valign: 'middle', textColor: [0, 0, 0]
                },
                headStyles: {
                    fillColor: [242, 242, 242], textColor: [0, 0, 0],
                    fontStyle: 'bold', lineColor: [68, 68, 68], lineWidth: 0.2
                },
                columnStyles: {
                    0: { cellWidth: SEC12_MM[0], halign: 'center' },
                    1: { cellWidth: SEC12_MM[1] },
                    2: { cellWidth: SEC12_MM[2] }
                },
                rowPageBreak: 'avoid'
            });
            y = doc.lastAutoTable.finalY + 2;

            const numbered = (items) => items.length
                ? items.map((t, i) => `${i + 1}. ${t}`).join('\n')
                : '—';

            doc.autoTable({
                startY: y,
                body: [[
                    { content: `PRAISING POINTS:\n${numbered(m.praising)}`, styles: { halign: 'left', valign: 'top' } },
                    { content: `PRAYER POINTS:\n${numbered(m.prayer)}`, styles: { halign: 'left', valign: 'top' } }
                ]],
                theme: 'grid',
                margin: { left: 14, right: 14 },
                styles: {
                    font: 'times', fontSize: 9, lineColor: [68, 68, 68], lineWidth: 0.2,
                    cellPadding: 3, valign: 'top', textColor: [0, 0, 0]
                },
                columnStyles: { 0: { cellWidth: 91 }, 1: { cellWidth: 91 } }
            });
        }

        // Itinerary sign-off
        if (m.footer) drawFooterPdf(doc, m.footer, sig, doc.lastAutoTable.finalY);

        doc.save(`${fileBase(m)}.pdf`);
    }

    /* =====================================================
       Excel
       ===================================================== */
    function exportExcel(m) {
        if (typeof XLSX === 'undefined') throw new Error('SheetJS not loaded');

        const aoa = [];
        const merges = [];

        const pushMerged = (text) => {
            const r = aoa.length;
            aoa.push([text]);
            merges.push({ s: { r, c: 0 }, e: { r, c: 2 } });
        };

        pushMerged(isItin ? orgLine(m) : `${ORG} — ${m.region}`);
        pushMerged(m.title);
        pushMerged(`NAME: ${m.name}   |   BASE: ${m.base}   |   REGION: ${m.region}   |   MONTH: ${m.monthName}, ${m.year}`);
        aoa.push([]);

        if (kind.isField) {
            pushMerged('KRA (KEY RESULTING AREA) OBJECTIVES:');
            if (m.kraObjectives.length === 0) {
                pushMerged('No KRA objectives were set for this month.');
            } else {
                m.kraObjectives.forEach((k) => {
                    const r = aoa.length;
                    aoa.push([`${k.n}.`, '', k.text]);
                    merges.push({ s: { r, c: 1 }, e: { r, c: 1 } });
                });
            }
            aoa.push([]);
        }

        aoa.push([kind.dayHead, kind.midHead, 'ACTIVITIES WITH DETAILS AND PROGRESS']);
        m.mainGroups.forEach((g) => aoa.push([dayText(g.dates), midValue(g), g.activity || '']));

        if (kind.isField) {
            aoa.push([]);
            pushMerged('12. Other than KRA:');
            aoa.push(['DATE', 'PLACE AND PURPOSE', 'PARTICULARS, PROBLEMS AND HIGHLIGHTS']);
            if (m.otherEntries.length === 0) {
                aoa.push(['—', '—', 'No entries for this month.']);
            } else {
                m.otherEntries.forEach((e) => aoa.push([
                    String(Number(e.date.slice(8, 10))), e.place, e.activity || ''
                ]));
            }
            aoa.push([]);
            aoa.push([
                'PRAISING POINTS:\n' + (m.praising.length ? m.praising.map((t, i) => `${i + 1}. ${t}`).join('\n') : '—'),
                'PRAYER POINTS:\n' + (m.prayer.length ? m.prayer.map((t, i) => `${i + 1}. ${t}`).join('\n') : '—'),
                ''
            ]);
        }

        if (m.footer) {
            const f = m.footer;
            const left = ['Copy to,', ...f.copyTo];
            const right = ['Submitted by,', '', f.name, ...(f.role ? [f.role] : [])];
            aoa.push([]);
            for (let i = 0; i < Math.max(left.length, right.length); i++) {
                const r = aoa.length;
                aoa.push([left[i] || '', '', right[i] || '']);
                merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
            }
        }

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!merges'] = merges;
        ws['!cols'] = [{ wch: 14 }, { wch: isItin ? 24 : 12 }, { wch: 80 }];
        ws['!rows'] = aoa.map((_, i) => (i < 3 ? { hpt: 26 } : {}));

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, kind.sheet);
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
        return '<w:p><w:pPr><w:spacing w:before="0" w:after="0"/>' +
            ind +
            (o.center ? '<w:jc w:val="center"/>' : '') +
            (o.left ? '<w:jc w:val="left"/>' : '') +
            '</w:pPr>' + runs + '</w:p>';
    }

    function docxCell(width, paragraphs, o = {}) {
        let tcPr = `<w:tcW w:w="${width}" w:type="dxa"/>`;
        if (o.span) tcPr += `<w:gridSpan w:val="${o.span}"/>`;
        if (o.shade) tcPr += '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>';
        if (o.shadeBrand) tcPr += '<w:shd w:val="clear" w:color="auto" w:fill="075E54"/>';
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

    const buildTable = (rowsXml, widths) => {
        const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="444444"/>`;
        return '<w:tbl><w:tblPr>' +
            `<w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>` +
            '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('') + '</w:tblBorders>' +
            '<w:tblLayout w:type="fixed"/></w:tblPr>' +
            `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
            rowsXml.join('') + '</w:tbl>';
    };

    function docxFooter(f, sig, textW) {
        // Copy to gets 60% of the width, Submitted by takes the rest on the right
        const leftW = Math.round(textW * 0.6);
        const rightW = textW - leftW;

        const left = [docxPara(docxRun('Copy to,', { b: true }))]
            .concat(f.copyTo.map((line) => docxPara(docxRun(line))));

        const right = [docxPara(docxRun('Submitted by,', { b: true }))];
        if (sig) {
            const { cx, cy } = sigEmu(sig);
            right.push(docxPara(docxImage('rIdSig', cx, cy, 2, 'Signature')));
        } else {
            right.push(docxPara(''));
        }
        right.push(docxPara(docxRun(f.name, { b: true })));
        if (f.role) right.push(docxPara(docxRun(f.role)));

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

    function buildDocumentXml(m, logo, sig) {
        const TW = W.tw;
        const MAIN_W = TW.reduce((a, b) => a + b, 0);
        const SEC_W = SEC12_TW.reduce((a, b) => a + b, 0);
        const rows = [];

        const brandRuns = (logo ? docxImage('rIdLogo', LOGO_EMU, LOGO_EMU, 1, 'UESI Logo') + docxRun('  ') : '') +
            docxRun(orgLine(m), { b: true, sz: 24 });
        rows.push(docxRow([docxCell(MAIN_W, docxPara(brandRuns, { center: true }), { span: 3 })], { height: 900 }));

        if (!isItin) {
            rows.push(docxRow([docxCell(MAIN_W, docxPara(docxRun(`${ORG} — ${m.region}`, { b: true, sz: 26 }), { center: true }), { span: 3 })]));
        }
        rows.push(docxRow([docxCell(MAIN_W, docxPara(docxRun(m.title, { b: true, sz: 30, color: '075E54' }), { center: true }), { span: 3 })]));

        rows.push(docxRow([docxCell(MAIN_W, docxPara(
            docxRun('NAME: ', { b: true }) + docxRun(m.name) + docxRun('      BASE: ', { b: true }) + docxRun(m.base),
            { left: true }
        ), { span: 3 })]));
        rows.push(docxRow([docxCell(MAIN_W, docxPara(
            docxRun('REGION: ', { b: true }) + docxRun(m.region) +
            docxRun('      MONTH: ', { b: true }) + docxRun(`${m.monthName}, ${m.year}`),
            { left: true }
        ), { span: 3 })]));

        if (kind.isField) {
            rows.push(docxRow([docxCell(MAIN_W, docxPara(
                docxRun('KRA (KEY RESULTING AREA) OBJECTIVES:', { b: true, color: '075E54' }), { left: true }
            ), { span: 3, shade: true })]));
            if (m.kraObjectives.length === 0) {
                rows.push(docxRow([docxCell(MAIN_W, docxPara(docxRun('No KRA objectives were set for this month.'), { left: true }), { span: 3 })]));
            } else {
                m.kraObjectives.forEach((k) => rows.push(docxRow([docxCell(MAIN_W, docxPara(
                    docxRun(`${k.n}. `, { b: true }) + docxRun(k.text), { left: true, hang: true }
                ), { span: 3 })])));
            }
        }

        const heads = [kind.dayHead, kind.midHead, 'ACTIVITIES WITH DETAILS AND PROGRESS'];
        rows.push(docxRow(heads.map((h, i) =>
            docxCell(TW[i], docxPara(docxRun(h, { b: true }), { center: true }), { shade: true })
        )));

        const lines = (text) => (text || '—').split('\n').map((l) => docxPara(docxRun(l), { left: true })).join('');
        m.mainGroups.forEach((g) => {
            rows.push(docxRow([
                docxCell(TW[0], docxPara(docxRun(dayText(g.dates)), { center: true }), { vAlign: 'top' }),
                docxCell(TW[1], docxPara(docxRun(midValue(g)), { center: true }), { vAlign: 'top' }),
                docxCell(TW[2], lines(g.activity), { vAlign: 'top' })
            ]));
        });

        let extra = '';

        if (kind.isField) {
            const secRows = [];
            secRows.push(docxRow([docxCell(SEC_W, docxPara(docxRun('12. Other than KRA:', { b: true, color: 'FFFFFF' }), { left: true }), { span: 3, shadeBrand: true })]));
            secRows.push(docxRow([
                docxCell(SEC12_TW[0], docxPara(docxRun('DATE', { b: true }), { center: true }), { shade: true }),
                docxCell(SEC12_TW[1], docxPara(docxRun('PLACE AND PURPOSE', { b: true }), { center: true }), { shade: true }),
                docxCell(SEC12_TW[2], docxPara(docxRun('PARTICULARS, PROBLEMS AND HIGHLIGHTS', { b: true }), { center: true }), { shade: true })
            ]));
            if (m.otherEntries.length === 0) {
                secRows.push(docxRow([
                    docxCell(SEC12_TW[0], docxPara(docxRun('—'), { center: true })),
                    docxCell(SEC12_TW[1], docxPara(docxRun('—'), { center: true })),
                    docxCell(SEC12_TW[2], docxPara(docxRun('No entries for this month.'), { center: true }))
                ]));
            } else {
                m.otherEntries.forEach((e) => secRows.push(docxRow([
                    docxCell(SEC12_TW[0], docxPara(docxRun(String(Number(e.date.slice(8, 10)))), { center: true }), { vAlign: 'top' }),
                    docxCell(SEC12_TW[1], docxPara(docxRun(e.place), { left: true }), { vAlign: 'top' }),
                    docxCell(SEC12_TW[2], lines(e.activity), { vAlign: 'top' })
                ])));
            }

            const reflCell = (title, items) => docxPara(docxRun(title, { b: true, color: '075E54' }), { left: true }) +
                (items.length
                    ? items.map((t, i) => docxPara(docxRun(`${i + 1}. ${t}`), { left: true, hang: true })).join('')
                    : docxPara(docxRun('—'), { left: true }));

            const half = Math.floor(SEC_W / 2);
            const refRows = [docxRow([
                docxCell(half, reflCell('PRAISING POINTS:', m.praising), { vAlign: 'top' }),
                docxCell(SEC_W - half, reflCell('PRAYER POINTS:', m.prayer), { vAlign: 'top' })
            ])];

            extra = buildTable(secRows, SEC12_TW) + docxPara('') +
                buildTable(refRows, [half, SEC_W - half]);
        }

        const footer = m.footer ? docxPara('') + docxFooter(m.footer, sig, MAIN_W) : '';

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<w:document ' +
            'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
            'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
            'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
            '<w:body>' +
            buildTable(rows, TW) + docxPara('') +
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
            const sig = model.footer?.signatureUrl
                ? await imageInfo(model.footer.signatureUrl).catch(() => null)
                : null;

            await new Promise((r) => setTimeout(r, 50));

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