
(() => {
    'use strict';

    const { $, Session, notify, setLoading } = window.UI;

    const KINDS = {
        field: { path: 'Field_Report', title: 'FIELD REPORT', label: 'Field Report', sheet: 'Field Report', dayHead: 'Day' },
        itinerary: { path: 'Itinerary_Form', title: 'ITINERARY', label: 'Itinerary', sheet: 'Itinerary Report', dayHead: 'DAY' }
    };
    const kind = KINDS[document.body.dataset.kind] || KINDS.field;

    const DB_ROOT = 'apps/uesi/staff-work/users';
    const LOGO = 'https://uesiap.github.io/vidhyarthi-geethavali/assets/Icons/uesi192.jpg';
    const SPECIAL_WORDS = ['day off', 'preparation', 'holidays', 'leave', 'sick'];
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const LOAD_TIMEOUT_MS = 20000;
    const MONTHS = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const COLS = ['Sl. No', 'Date', kind.dayHead, 'Zone / Division', 'Purpose'];

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
        base: (params.get('base') || '').trim(),
        state: (params.get('state') || '').trim(),
        month: Number(params.get('month')),
        year: Number(params.get('year'))
    };
    const requestOk = Boolean(
        request.base && request.state &&
        Number.isInteger(request.month) && request.month >= 1 && request.month <= 12 &&
        Number.isInteger(request.year) && request.year >= 2000 && request.year <= 2100
    );

    /* ---------- State ---------- */
    const view = { key: undefined, session: null, rows: null, loaded: false, error: false };
    let model = null;

    /* ---------- Helpers ---------- */
    const pad = (n) => String(n).padStart(2, '0');
    const fmtDate = (ymd) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
    const dayOfWeek = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });
    const dayGap = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
    const samePoints = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const isSpecial = (points) => {
        const text = points.join(' ').toLowerCase();
        return SPECIAL_WORDS.some((w) => text.includes(w));
    };
    const safeName = (s) => s.replace(/[\\/:*?"<>|]+/g, '').trim();
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

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

    /* ---------- Build report rows (same grouping rules as before) ---------- */
    function buildRows(entries) {
        const rows = [];
        let sl = 1;
        let i = 0;

        while (i < entries.length) {
            const head = entries[i];
            const groupable = !isSpecial(head.purpose);
            let j = i + 1;

            while (
                groupable && j < entries.length &&
                head.zone === entries[j].zone &&
                samePoints(head.purpose, entries[j].purpose) &&
                dayGap(entries[j - 1].date, entries[j].date) === 1
            ) {
                j++;
            }

            const span = j - i;
            for (let k = i; k < j; k++) {
                rows.push({
                    sl: sl++,
                    date: entries[k].date,
                    day: entries[k].day,
                    zone: head.zone,
                    purpose: head.purpose,
                    span: k === i ? span : 0   // only the first row of a group carries the span
                });
            }
            i = j;
        }
        return rows;
    }

    function buildModel() {
        const monthName = MONTHS[request.month - 1];
        return {
            title: `${kind.title} - ${monthName.toUpperCase()} ${request.year}`,
            monthName,
            year: request.year,
            state: request.state,
            base: request.base,
            name: view.session.name,
            rows: view.rows
        };
    }

    const fileBase = (m) => safeName(`${m.name} ${kind.label} ${m.monthName} ${m.year}`);

    /* ---------- Data ---------- */
    async function load() {
        const key = view.key;
        view.loaded = false;
        view.error = false;
        view.rows = null;
        render();

        const safeEmail = view.session.email.replace(/\./g, '_');
        const path = `${DB_ROOT}/${safeEmail}/userData/${kind.path}/${request.year}/${pad(request.month)}`;

        try {
            const snap = await withTimeout(db.ref(path).once('value'), LOAD_TIMEOUT_MS);
            if (view.key !== key) return; // user logged out or changed while loading

            const entries = [];
            snap.forEach((child) => {
                const date = child.key;
                const val = child.val();
                if (!DATE_RE.test(date) || !val || typeof val !== 'object') return;
                entries.push({
                    date,
                    day: val.day || dayOfWeek(date),
                    zone: String(val.zone || '').trim(),
                    purpose: toPoints(val.purpose)
                });
            });
            entries.sort((a, b) => a.date.localeCompare(b.date));
            view.rows = buildRows(entries);
        } catch (err) {
            if (view.key !== key) return;
            console.error('Report load failed:', err);
            view.error = true;
        }

        view.loaded = true;
        render();
    }

    /* ---------- Paper (on-screen preview) ---------- */
    function buildHead(m) {
        const brand = el('div', 'rpt-brand');
        const logo = el('img', 'rpt-logo');
        logo.src = LOGO;
        logo.alt = '';
        brand.append(logo, el('span', '', `Union of Evangelical Students of India - ${m.state}`));

        const brandCell = el('td');
        brandCell.colSpan = 5;
        brandCell.append(brand);

        const thead = el('thead');
        thead.append(
            tr('rpt-main', [brandCell]),
            tr('rpt-title', [cell(m.title, 5)]),
            tr('rpt-staff', [cell(`NAME: ${m.name}    Base: ${m.base}`, 5)]),
            tr('', COLS.map((c) => el('th', '', c)))
        );
        return thead;
    }

    function pointsList(points) {
        const ol = el('ol', 'pts');
        if (points.length === 0) ol.append(el('li', '', 'No purpose specified'));
        points.forEach((p) => ol.append(el('li', '', p)));
        return ol;
    }

    function buildBody(rows) {
        const tbody = el('tbody');
        rows.forEach((row) => {
            const cells = [
                cell(String(row.sl)),
                cell(fmtDate(row.date), 1, 'nw'),
                cell(row.day, 1, 'nw')
            ];

            if (row.span > 0) {
                const zone = cell(row.zone, 1, 'mid');
                zone.rowSpan = row.span;

                const purpose = el('td', 'pts-cell mid');
                purpose.rowSpan = row.span;
                purpose.append(pointsList(row.purpose));

                cells.push(zone, purpose);
            }
            tbody.append(tr('', cells));
        });
        return tbody;
    }

    function renderPaper(m) {
        const table = el('table', 'rpt');
        table.append(buildHead(m), buildBody(m.rows));

        const scroll = el('div', 'rpt-scroll');
        scroll.append(table);
        $('paper').replaceChildren(scroll);
    }

    /* ---------- Render ---------- */
    function render() {
        const authed = Boolean(view.session);
        const hasRows = authed && requestOk && Array.isArray(view.rows) && view.rows.length > 0;
        const noData = authed && requestOk && view.loaded && !view.error &&
            Array.isArray(view.rows) && view.rows.length === 0;

        $('loadState').hidden = !(authed && requestOk && !view.loaded);
        $('errorState').hidden = !(authed && (!requestOk || view.error));
        $('errorText').textContent = requestOk
            ? 'Could not load the report. Check your connection.'
            : 'The report details are missing. Please generate the report again.';
        $('retryBtn').hidden = !requestOk;
        $('noData').hidden = !noData;
        $('paper').hidden = !hasRows;
        $('exportBar').hidden = !hasRows;

        if (hasRows) {
            model = buildModel();
            renderPaper(model);
        } else {
            model = null;
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

    /* ---------- PDF ---------- */
    function exportPdf(m) {
        if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF not loaded');

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        doc.setFont('times', 'normal');
        doc.setFontSize(9);

        const PAD = 2;
        const PURPOSE_W = 100; // 12 + 20 + 22 + 28 + 100 = 182mm, fits A4 with 14mm margins

        // Hanging indent: wrapped lines line up under the text, not the number
        const hanging = (points) => {
            const maxW = PURPOSE_W - PAD * 2;
            const space = doc.getTextWidth(' ');
            const lines = [];
            points.forEach((point, idx) => {
                const prefix = `${idx + 1}. `;
                const indent = doc.getTextWidth(prefix);
                const wrapped = doc.splitTextToSize(point, maxW - indent);
                wrapped.forEach((line, li) => {
                    lines.push(li === 0
                        ? prefix + line
                        : ' '.repeat(Math.max(0, Math.round(indent / space))) + line);
                });
            });
            return lines.join('\n');
        };

        const body = m.rows.map((row) => {
            const cells = [row.sl, fmtDate(row.date), row.day];
            if (row.span > 0) {
                cells.push(
                    { content: row.zone, rowSpan: row.span },
                    { content: hanging(row.purpose), rowSpan: row.span }
                );
            }
            return cells;
        });

        const head = [
            [{ content: `Union of Evangelical Students of India - ${m.state}`, colSpan: 5, styles: { fontSize: 12, fontStyle: 'bold' } }],
            [{ content: m.title, colSpan: 5, styles: { fontSize: 15, fontStyle: 'bold', textColor: [7, 94, 84] } }],
            [{ content: `NAME: ${m.name}      Base: ${m.base}`, colSpan: 5, styles: { fontSize: 12, fontStyle: 'bold' } }],
            COLS.map((c) => ({ content: c, styles: { fontSize: 10, fontStyle: 'bold', fillColor: [242, 242, 242] } }))
        ];

        doc.autoTable({
            startY: 12,
            head,
            body,
            theme: 'grid',
            margin: { left: 14, right: 14 },
            styles: {
                font: 'times',
                fontSize: 9,
                valign: 'middle',
                halign: 'center',
                lineColor: [68, 68, 68],
                lineWidth: 0.2,
                cellPadding: PAD,
                textColor: [0, 0, 0]
            },
            headStyles: {
                fillColor: [255, 255, 255],
                textColor: [0, 0, 0],
                fontStyle: 'bold',
                lineColor: [68, 68, 68],
                lineWidth: 0.2,
                halign: 'center'
            },
            columnStyles: {
                0: { cellWidth: 12 },
                1: { cellWidth: 20 },
                2: { cellWidth: 22 },
                3: { cellWidth: 28 },
                4: { halign: 'left', cellWidth: PURPOSE_W }
            },
            rowPageBreak: 'avoid'
        });

        doc.save(`${fileBase(m)}.pdf`);
    }

    /* ---------- Excel ---------- */
    function exportExcel(m) {
        if (typeof XLSX === 'undefined') throw new Error('SheetJS not loaded');

        const HEADER_ROW = 4;
        const aoa = [
            [`Union of Evangelical Students of India - ${m.state}`],
            [m.title],
            [`NAME: ${m.name}      Base: ${m.base}`],
            [],
            COLS
        ];
        const merges = [
            { s: { r: 0, c: 0 }, e: { r: 0, c: 4 } },
            { s: { r: 1, c: 0 }, e: { r: 1, c: 4 } },
            { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } }
        ];

        m.rows.forEach((row) => {
            const r = aoa.length;
            if (row.span > 0) {
                aoa.push([
                    row.sl,
                    fmtDate(row.date),
                    row.day,
                    row.zone,
                    row.purpose.map((p, i) => `${i + 1}. ${p}`).join('\n')
                ]);
                if (row.span > 1) {
                    merges.push({ s: { r, c: 3 }, e: { r: r + row.span - 1, c: 3 } });
                    merges.push({ s: { r, c: 4 }, e: { r: r + row.span - 1, c: 4 } });
                }
            } else {
                aoa.push([row.sl, fmtDate(row.date), row.day, '', '']);
            }
        });

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!merges'] = merges;
        ws['!cols'] = [{ wch: 8 }, { wch: 12 }, { wch: 12 }, { wch: 18 }, { wch: 60 }];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, kind.sheet);
        XLSX.writeFile(wb, `${fileBase(m)}.xlsx`);
    }

    /* ---------- Word (HTML saved as .doc) ---------- */
    function exportWord(m) {
        const rowsHtml = m.rows.map((row) => {
            let html = `<tr><td>${row.sl}</td><td class="nw">${fmtDate(row.date)}</td><td class="nw">${escapeHtml(row.day)}</td>`;
            if (row.span > 0) {
                const points = row.purpose.map((p) => `<li>${escapeHtml(p)}</li>`).join('');
                html += `<td rowspan="${row.span}" class="mid">${escapeHtml(row.zone)}</td>` +
                    `<td rowspan="${row.span}" class="mid" style="text-align:left;"><ol style="margin:0;padding-left:1.2em;">${points}</ol></td>`;
            }
            return html + '</tr>';
        }).join('');

        const headCells = COLS.map((c) => `<th>${escapeHtml(c)}</th>`).join('');

        const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(fileBase(m))}</title>
<style>
body { font-family: 'Times New Roman', Times, serif; color: #000; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
td, th { border: 1px solid #444; padding: 6px; text-align: center; vertical-align: top; font-family: 'Times New Roman', Times, serif; font-size: 12px; }
th { background: #f2f2f2; font-weight: bold; }
.main td { font-weight: bold; font-size: 15px; }
.title td { font-weight: bold; font-size: 18px; color: #075E54; }
.staff td { font-weight: bold; font-size: 15px; }
.nw { white-space: nowrap; }
.mid { vertical-align: middle; }
</style>
</head>
<body>
<table>
<colgroup>
<col style="width:8%"><col style="width:12%"><col style="width:12%"><col style="width:18%"><col style="width:50%">
</colgroup>
<thead>
<tr class="main"><td colspan="5">Union of Evangelical Students of India - ${escapeHtml(m.state)}</td></tr>
<tr class="title"><td colspan="5">${escapeHtml(m.title)}</td></tr>
<tr class="staff"><td colspan="5">NAME: ${escapeHtml(m.name)} &nbsp;&nbsp;&nbsp;&nbsp; Base: ${escapeHtml(m.base)}</td></tr>
<tr>${headCells}</tr>
</thead>
<tbody>${rowsHtml}</tbody>
</table>
</body>
</html>`;

        saveBlob(
            new Blob(['\ufeff', html], { type: 'application/msword' }),
            `${fileBase(m)}.doc`
        );
    }

    /* ---------- Export runner ---------- */
    async function runExport(type) {
        if (!model) {
            notify('There is no data to export.', 'info');
            return;
        }

        closeSheet();
        const btn = $('exportBtn');
        setLoading(btn, true, 'Preparing...');
        await new Promise((r) => setTimeout(r, 50)); // let the spinner paint

        try {
            if (type === 'pdf') exportPdf(model);
            if (type === 'excel') exportExcel(model);
            if (type === 'word') exportWord(model);
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
        view.rows = null;
        view.loaded = false;
        view.error = false;

        if (session && requestOk) load();
        else render();
    }

    /* ---------- Events ---------- */
    $('backBtn').addEventListener('click', () => {
        if (history.length > 1) history.back();
        else location.href = '/apps/uesi/staff-work/';
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

    // Clear the export spinner if the page is restored from history
    window.addEventListener('pageshow', () => {
        setLoading($('exportBtn'), false);
    });

    Session.watch(onAuth);
})();