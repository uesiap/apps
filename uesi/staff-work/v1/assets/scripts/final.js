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
            dayHead: 'Date(s)'
        },
        itinerary: {
            path: 'Itinerary_Form',
            title: 'FIELD STAFF ITINERARY',
            sheet: 'Itinerary',
            label: 'Itinerary',
            isField: false,
            dayHead: 'DATE(S)'
        }
    };
    const kind = KINDS[document.body.dataset.kind] || KINDS.field;

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

    // Column widths (percent for preview; mm for PDF; twips for Word)
    const COL_PCT = ['12%', '8%', '80%'];
    const COL_MM = [28, 18, 136]; // total 182mm (A4 with 14mm margins)
    const COL_TW = [1600, 1000, 7866]; // total 10466 twips
    const COL_PCT_SEC12 = ['10%', '25%', '65%'];
    const COL_MM_SEC12 = [22, 48, 112];
    const COL_TW_SEC12 = [1200, 2800, 6466];

    const LOGO_MM = 12;
    const LOGO_EMU = 548640;

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
        month: Number(params.get('month')),
        year: Number(params.get('year'))
    };
    const requestOk = Boolean(
        request.base && request.region &&
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
    const isSunday = (ymd) => new Date(ymd + 'T12:00:00').getDay() === 0;
    const safeName = (s) => s.replace(/[\\/:*?"<>|]+/g, '').trim();
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));

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

    const fileBase = (m) =>
        safeName(`${m.name} ${kind.label} - ${m.monthName} ${m.year}`);

    /* ---------- Logo ---------- */
    let logoPromise = null;
    function loadLogo() {
        if (!logoPromise) {
            logoPromise = fetch(LOGO, { cache: 'force-cache' })
                .then((r) => { if (!r.ok) throw new Error('logo'); return r.blob(); })
                .then((blob) => new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve({
                        dataUrl: reader.result,
                        base64: String(reader.result).split(',')[1],
                        isPng: /png/i.test(blob.type),
                        fmt: /png/i.test(blob.type) ? 'PNG' : 'JPEG',
                        ext: /png/i.test(blob.type) ? 'png' : 'jpeg'
                    });
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                }))
                .catch((err) => {
                    console.warn('Logo unavailable:', err);
                    return null;
                });
        }
        return logoPromise;
    }

    /* ---------- Row grouping (identical consecutive date+place+activity) ---------- */
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
                consecutiveDay(entries[j - 1].date, entries[j].date)
            ) j++;
            out.push({ ...head, dates: entries.slice(i, j).map((e) => e.date) });
            i = j;
        }
        return out;
    }
    const sameKra = (a, b) => (a.kra ?? null) === (b.kra ?? null);
    function consecutiveDay(a, b) {
        const da = new Date(a + 'T12:00:00');
        const db2 = new Date(b + 'T12:00:00');
        return Math.round((db2 - da) / 86400000) === 1;
    }

    /* ---------- Build model ---------- */
    function buildModel(entries, kraObjectives, reflection) {
        const monthName = MONTHS[request.month - 1];

        const mainGroups = entries.filter((e) => kind.isField ? e.kra !== 0 : true);
        const otherEntries = kind.isField ? entries.filter((e) => e.kra === 0) : [];

        return {
            title: `${kind.title} - ${monthName.toUpperCase()} ${request.year}`,
            monthName,
            year: request.year,
            region: request.region,
            base: request.base,
            name: request.name || view.session.name,
            mainGroups: groupConsecutive(mainGroups),
            otherEntries,
            kraObjectives,   // [{n:1, text:"..."}, ...]
            praising: reflection.praising || [],
            prayer: reflection.prayer || []
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

        const entriesPath =
            `${DB_ROOT}/${safeEmail}/userData/${kind.path}/${request.year}/${month}`;
        const kraPath =
            `${DB_ROOT}/${safeEmail}/userData/KRA_Objectives/${request.year}/${month}`;
        const refPath =
            `${DB_ROOT}/${safeEmail}/userData/Monthly_Reflection/${request.year}/${month}`;

        try {
            const [entriesSnap, kraSnap, refSnap] = await withTimeout(
                Promise.all([
                    db.ref(entriesPath).once('value'),
                    kind.isField ? db.ref(kraPath).once('value') : Promise.resolve(null),
                    kind.isField ? db.ref(refPath).once('value') : Promise.resolve(null)
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
                    place: String(val.place || '').trim(),
                    activity: String(val.activity || '').trim()
                });
            });
            entries.sort((a, b) => a.date.localeCompare(b.date));

            let kraObjectives = [];
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

    /* ---------- Preview (paper) ---------- */
    function brandRow() {
        const wrap = el('div', 'rpt-brand');
        const img = el('img', 'rpt-logo');
        img.src = LOGO; img.alt = '';
        const txt = el('span', 'rpt-brand-text', ORG);
        wrap.append(img, txt);
        const td = el('td');
        td.colSpan = 3;
        td.append(wrap);
        return tr('', [td]);
    }

    function titleRow(m) {
        return tr('rpt-title', [cell(`${ORG} — ${m.region}`, 3)]);
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

        left.append(
            row('NAME', m.name),
            row('REGION', m.region)
        );
        right.append(
            row('BASE', m.base),
            row('MONTH', `${m.monthName}, ${m.year}`)
        );

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
            // Fill 1..5 slots, show only ones set
            m.kraObjectives.forEach((k) => {
                const li = el('li', '', k.text);
                list.append(li);
            });
        }

        const bodyTd = el('td');
        bodyTd.colSpan = 3;
        bodyTd.append(list);

        return tr('rpt-kra-body', [bodyTd]);
    }

    function headMainTable() {
        const r = el('tr');
        const hDate = el('th', 'col-date', kind.dayHead);
        const hKra = el('th', 'col-kra', 'KRA');
        const hAct = el('th', 'col-act', 'ACTIVITIES WITH DETAILS AND PROGRESS');
        r.append(hDate, hKra, hAct);
        return r;
    }

    function renderMainRows(groups) {
        return groups.map((g) => {
            const dateText = g.dates.map((d) => String(Number(d.slice(8, 10)))).join(', ');

            const cells = [
                cell(dateText, 1, 'nw'),
                kind.isField ? cell(String(g.kra), 1, 'nw') : cell('', 1, 'nw'),
                cell('', 1, 'rpt-activity')
            ];
            // set activity text
            cells[2].textContent = g.activity || '—';
            return tr('', cells);
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
            const dateText = String(Number(e.date.slice(8, 10)));
            const cells = [
                cell(dateText, 1, 'nw'),
                cell(e.place, 1, ''),
                cell('', 1, 'rpt-activity')
            ];
            cells[2].textContent = e.activity || '—';
            return tr('', cells);
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
            if (items.length === 0) {
                list.append(el('li', '', '—'));
            } else {
                items.forEach((t) => list.append(el('li', '', t)));
            }
            c.append(list);
            return c;
        };

        wrap.append(
            col('PRAISING POINTS:', m.praising),
            col('PRAYER POINTS:', m.prayer)
        );

        td.append(wrap);
        return tr('', [td]);
    }

    function renderPaper(m) {
        const table = el('table', 'rpt');

        // Header (brand + doc title + info)
        const thead = el('thead');
        thead.append(
            brandRow(),
            docTitleRow(m),
            infoRow(m)
        );

        // Body
        const tbody = el('tbody');

        if (kind.isField) {
            tbody.append(kraObjectivesRow(m));
        }

        tbody.append(headMainTable(), ...renderMainRows(m.mainGroups));

        if (kind.isField) {
            tbody.append(...section12Rows(m.otherEntries));
            tbody.append(reflectRow(m));
        }

        table.append(thead, tbody);

        const scroll = el('div', 'rpt-scroll');
        scroll.append(table);
        $('paper').replaceChildren(scroll);
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
        a.href = url; a.download = filename;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    /* =====================================================
       PDF export
       ===================================================== */
    function exportPdf(m, logo) {
        if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF not loaded');
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        doc.setFont('times', 'normal');
        doc.setFontSize(9);

        const PAD = 2;
        const textWidth = (s, f = 'normal', sz = 9) => {
            doc.setFont('times', f);
            doc.setFontSize(sz);
            return doc.getTextWidth(s);
        };

        // Main table head
        const head1 = [
            [{ content: '', colSpan: 3, styles: { minCellHeight: 14 } }], // brand row
            [{ content: `${ORG} — ${m.region}`, colSpan: 3, styles: { fontSize: 14, fontStyle: 'bold', textColor: [7, 94, 84] } }],
            [{ content: m.title, colSpan: 3, styles: { fontSize: 15, fontStyle: 'bold', textColor: [7, 94, 84] } }],
            [{ content: '', colSpan: 3, styles: { minCellHeight: 2, lineWidth: 0 } }] // spacer
        ];

        // Info grid — draw manually as its own table, then start main table below.
        // Simpler: render info as a 4-column table.
        const infoBody = [
            ['NAME', m.name, 'BASE', m.base],
            ['REGION', m.region, 'MONTH', `${m.monthName}, ${m.year}`]
        ];

        let cursorY = 12;

        // Brand row drawn manually
        doc.setFont('times', 'bold');
        doc.setFontSize(12);
        doc.setTextColor(0, 0, 0);
        const brandText = ORG;
        const gap = 3;
        const textW = doc.getTextWidth(brandText);
        const total = logo ? LOGO_MM + gap + textW : textW;
        const x0 = (210 - total) / 2;
        if (logo) doc.addImage(logo.dataUrl, logo.fmt, x0, cursorY + 2, LOGO_MM, LOGO_MM);
        doc.text(brandText, x0 + (logo ? LOGO_MM + gap : 0), cursorY + 8, { baseline: 'middle' });
        cursorY += 16;

        // Doc subtitle
        doc.setFont('times', 'bold');
        doc.setFontSize(14);
        doc.setTextColor(7, 94, 84);
        doc.text(`${ORG} — ${m.region}`, 105, cursorY + 4, { align: 'center' });
        cursorY += 8;
        doc.setFontSize(15);
        doc.text(m.title, 105, cursorY + 5, { align: 'center' });
        cursorY += 12;

        // Info table
        doc.autoTable({
            startY: cursorY,
            body: infoBody,
            theme: 'grid',
            margin: { left: 14, right: 14 },
            styles: {
                font: 'times', fontSize: 9,
                lineColor: [68, 68, 68], lineWidth: 0.2,
                cellPadding: 2, textColor: [0, 0, 0], valign: 'middle'
            },
            columnStyles: {
                0: { fontStyle: 'bold', fillColor: [248, 248, 248], cellWidth: 25 },
                1: { cellWidth: 66 },
                2: { fontStyle: 'bold', fillColor: [248, 248, 248], cellWidth: 25 },
                3: { cellWidth: 66 }
            }
        });
        cursorY = doc.lastAutoTable.finalY + 2;

        // KRA objectives block
        if (kind.isField) {
            const objHead = [[{ content: 'KRA (KEY RESULTING AREA) OBJECTIVES:', colSpan: 3, styles: {
                fontStyle: 'bold', fillColor: [238, 242, 241], textColor: [7, 94, 84], halign: 'left'
            } }]];

            let objBody = [];
            if (m.kraObjectives.length === 0) {
                objBody = [[{ content: 'No KRA objectives were set for this month.', colSpan: 3, styles: { halign: 'left' } }]];
            } else {
                objBody = m.kraObjectives.map((k) => ([
                    { content: '', styles: { cellWidth: 4, lineWidth: 0, cellPadding: 0 } },
                    { content: `${k.n}.`, styles: { cellWidth: 8, lineWidth: 0, halign: 'right' } },
                    { content: k.text, styles: { halign: 'left', lineWidth: 0 } }
                ]));
            }

            doc.autoTable({
                startY: cursorY,
                head: objHead,
                body: objBody,
                theme: 'grid',
                margin: { left: 14, right: 14 },
                styles: {
                    font: 'times', fontSize: 9,
                    lineColor: [68, 68, 68], lineWidth: 0.2,
                    cellPadding: 2, valign: 'top'
                },
                columnStyles: {
                    0: { cellWidth: 4 },
                    1: { cellWidth: 8 },
                    2: { cellWidth: 170 }
                }
            });
            cursorY = doc.lastAutoTable.finalY + 2;
        }

        // Main activity table
        const mainHead = [[
            { content: kind.dayHead, styles: { fontStyle: 'bold', halign: 'center' } },
            kind.isField
                ? { content: 'KRA', styles: { fontStyle: 'bold', halign: 'center' } }
                : { content: '', styles: { fontStyle: 'bold', halign: 'center' } },
            { content: 'ACTIVITIES WITH DETAILS AND PROGRESS', styles: { fontStyle: 'bold', halign: 'center' } }
        ]];

        const mainBody = m.mainGroups.map((g) => {
            const dateText = g.dates.map((d) => String(Number(d.slice(8, 10)))).join(', ');
            const row = [
                { content: dateText, styles: { halign: 'center' } },
                kind.isField
                    ? { content: String(g.kra), styles: { halign: 'center' } }
                    : { content: '', styles: { halign: 'center' } },
                { content: g.activity || '—', styles: { halign: 'left' } }
            ];
            return row;
        });

        doc.autoTable({
            startY: cursorY,
            head: mainHead,
            body: mainBody,
            theme: 'grid',
            margin: { left: 14, right: 14 },
            styles: {
                font: 'times', fontSize: 9,
                lineColor: [68, 68, 68], lineWidth: 0.2,
                cellPadding: 2, valign: 'middle', textColor: [0, 0, 0]
            },
            headStyles: {
                fillColor: [242, 242, 242], textColor: [0, 0, 0],
                fontStyle: 'bold', lineColor: [68, 68, 68], lineWidth: 0.2
            },
            columnStyles: {
                0: { cellWidth: COL_MM[0], halign: 'center' },
                1: { cellWidth: COL_MM[1], halign: 'center' },
                2: { cellWidth: COL_MM[2], halign: 'left' }
            },
            rowPageBreak: 'avoid'
        });
        cursorY = doc.lastAutoTable.finalY + 2;

        // Section 12
        if (kind.isField) {
            const secHead = [[{
                content: '12. Other than KRA:', colSpan: 3,
                styles: { fillColor: [7, 94, 84], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'left' }
            }]];

            const secBody = m.otherEntries.map((e) => {
                const dateText = String(Number(e.date.slice(8, 10)));
                return [
                    { content: dateText, styles: { halign: 'center' } },
                    { content: e.place, styles: { halign: 'left' } },
                    { content: e.activity || '—', styles: { halign: 'left' } }
                ];
            });

            if (secBody.length === 0) {
                secBody.push([
                    { content: '—', styles: { halign: 'center' } },
                    { content: '—', styles: { halign: 'center' } },
                    { content: 'No "Other than KRA" entries for this month.', styles: { halign: 'center', fontStyle: 'italic' } }
                ]);
            }

            doc.autoTable({
                startY: cursorY,
                head: [
                    ...secHead,
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
                    font: 'times', fontSize: 9,
                    lineColor: [68, 68, 68], lineWidth: 0.2,
                    cellPadding: 2, valign: 'middle', textColor: [0, 0, 0]
                },
                headStyles: {
                    fillColor: [242, 242, 242], textColor: [0, 0, 0],
                    fontStyle: 'bold', lineColor: [68, 68, 68], lineWidth: 0.2
                },
                columnStyles: {
                    0: { cellWidth: COL_MM_SEC12[0], halign: 'center' },
                    1: { cellWidth: COL_MM_SEC12[1] },
                    2: { cellWidth: COL_MM_SEC12[2] }
                },
                rowPageBreak: 'avoid'
            });
            cursorY = doc.lastAutoTable.finalY + 2;

            // Praise / prayer block
            const reflectBody = [[
                {
                    content: 'PRAISING POINTS:\n' +
                        (m.praising.length
                            ? m.praising.map((t, i) => `${i + 1}. ${t}`).join('\n')
                            : '—'),
                    styles: { halign: 'left', valign: 'top', fontStyle: 'normal' }
                },
                {
                    content: 'PRAYER POINTS:\n' +
                        (m.prayer.length
                            ? m.prayer.map((t, i) => `${i + 1}. ${t}`).join('\n')
                            : '—'),
                    styles: { halign: 'left', valign: 'top', fontStyle: 'normal' }
                }
            ]];

            doc.autoTable({
                startY: cursorY,
                body: reflectBody,
                theme: 'grid',
                margin: { left: 14, right: 14 },
                styles: {
                    font: 'times', fontSize: 9,
                    lineColor: [68, 68, 68], lineWidth: 0.2,
                    cellPadding: 3, valign: 'top', textColor: [0, 0, 0]
                },
                columnStyles: {
                    0: { cellWidth: 91 },
                    1: { cellWidth: 91 }
                }
            });
        }

        doc.save(`${fileBase(m)}.pdf`);
    }

    /* =====================================================
       Excel export
       ===================================================== */
    function exportExcel(m) {
        if (typeof XLSX === 'undefined') throw new Error('SheetJS not loaded');

        const aoa = [];
        const merges = [];

        const pushMerged = (text, bold = false) => {
            const r = aoa.length;
            aoa.push([text]);
            merges.push({ s: { r, c: 0 }, e: { r, c: 2 } });
        };

        pushMerged(`${ORG} — ${m.region}`, true);
        pushMerged(m.title, true);
        pushMerged(`NAME: ${m.name}   |   BASE: ${m.base}   |   REGION: ${m.region}   |   MONTH: ${m.monthName}, ${m.year}`, true);
        aoa.push([]);

        if (kind.isField) {
            pushMerged('KRA (KEY RESULTING AREA) OBJECTIVES:', true);
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

        // Main table header
        if (kind.isField) {
            aoa.push(['DATE(S)', 'KRA', 'ACTIVITIES WITH DETAILS AND PROGRESS']);
        } else {
            aoa.push(['DATE(S)', '', 'ACTIVITIES WITH DETAILS']);
        }

        m.mainGroups.forEach((g) => {
            const dateText = g.dates.map((d) => String(Number(d.slice(8, 10)))).join(', ');
            aoa.push([
                dateText,
                kind.isField ? g.kra : '',
                g.activity || ''
            ]);
        });

        if (kind.isField) {
            aoa.push([]);
            pushMerged('12. Other than KRA:', true);
            aoa.push(['DATE', 'PLACE AND PURPOSE', 'PARTICULARS, PROBLEMS AND HIGHLIGHTS']);
            if (m.otherEntries.length === 0) {
                aoa.push(['—', '—', 'No entries for this month.']);
            } else {
                m.otherEntries.forEach((e) => {
                    aoa.push([
                        String(Number(e.date.slice(8, 10))),
                        e.place,
                        e.activity || ''
                    ]);
                });
            }

            aoa.push([]);
            aoa.push([
                'PRAISING POINTS:\n' + (m.praising.length ? m.praising.map((t, i) => `${i + 1}. ${t}`).join('\n') : '—'),
                'PRAYER POINTS:\n' + (m.prayer.length ? m.prayer.map((t, i) => `${i + 1}. ${t}`).join('\n') : '—'),
                ''
            ]);
        }

        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!merges'] = merges;
        ws['!cols'] = [{ wch: 14 }, { wch: 12 }, { wch: 80 }];
        ws['!rows'] = aoa.map((row, i) => {
            if (i === 0 || i === 1 || i === 2) return { hpt: 26 };
            return {};
        });

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, kind.sheet);
        XLSX.writeFile(wb, `${fileBase(m)}.xlsx`);
    }

    /* =====================================================
       Word (.docx) export
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
        return '<w:p><w:pPr>' +
            '<w:spacing w:before="0" w:after="0"/>' +
            (o.hang ? '<w:ind w:left="284" w:hanging="284"/>' : '') +
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

    function docxLogoRun(logo) {
        const cx = LOGO_EMU;
        return '<w:r><w:drawing>' +
            '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
            `<wp:extent cx="${cx}" cy="${cx}"/>` +
            '<wp:docPr id="1" name="UESI Logo"/>' +
            '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
            '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
            '<pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="logo"/><pic:cNvPicPr/></pic:nvPicPr>' +
            '<pic:blipFill><a:blip r:embed="rIdLogo"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
            `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cx}"/></a:xfrm>` +
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
            '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
    }

    function buildDocumentXml(m, logo) {
        const MAIN_W = COL_TW.reduce((a, b) => a + b, 0);      // 10466
        const SEC_W = COL_TW_SEC12.reduce((a, b) => a + b, 0); // 10466

        const rows = [];

        // Brand
        const brandRuns = (logo ? docxLogoRun(logo) + docxRun('  ') : '') +
            docxRun(ORG, { b: true, sz: 24 });
        rows.push(docxRow([
            docxCell(MAIN_W, docxPara(brandRuns, { center: true }), { span: 3 })
        ], { height: 900 }));

        // Subtitle
        rows.push(docxRow([
            docxCell(MAIN_W, docxPara(docxRun(`${ORG} — ${m.region}`, { b: true, sz: 26 }), { center: true }), { span: 3 })
        ]));
        rows.push(docxRow([
            docxCell(MAIN_W, docxPara(docxRun(m.title, { b: true, sz: 30, color: '075E54' }), { center: true }), { span: 3 })
        ]));

        // Info grid as a nested table? Simpler: 4-column info rows across 3-col grid.
        // We'll render info as two merged rows so it fits into the 3-column grid.
        rows.push(docxRow([
            docxCell(Math.floor(MAIN_W / 2), docxPara(
                docxRun('NAME: ', { b: true }) + docxRun(m.name) + docxRun('    BASE: ', { b: true }) + docxRun(m.base),
                { left: true }
            ), { span: 3 })
        ]));
        rows.push(docxRow([
            docxCell(MAIN_W, docxPara(
                docxRun('REGION: ', { b: true }) + docxRun(m.region) +
                docxRun('    MONTH: ', { b: true }) + docxRun(`${m.monthName}, ${m.year}`),
                { left: true }
            ), { span: 3 })
        ]));

        // KRA objectives
        if (kind.isField) {
            rows.push(docxRow([
                docxCell(MAIN_W, docxPara(
                    docxRun('KRA (KEY RESULTING AREA) OBJECTIVES:', { b: true, color: '075E54' }),
                    { left: true }
                ), { span: 3, shade: true })
            ]));

            if (m.kraObjectives.length === 0) {
                rows.push(docxRow([
                    docxCell(MAIN_W, docxPara(docxRun('No KRA objectives were set for this month.'), { left: true }), { span: 3 })
                ]));
            } else {
                m.kraObjectives.forEach((k) => {
                    rows.push(docxRow([
                        docxCell(MAIN_W, docxPara(
                            docxRun(`${k.n}. `, { b: true }) + docxRun(k.text),
                            { left: true, hang: true }
                        ), { span: 3 })
                    ]));
                });
            }
        }

        // Main table header
        rows.push(docxRow([
            docxCell(COL_TW[0], docxPara(docxRun(kind.dayHead, { b: true }), { center: true }), { shade: true }),
            docxCell(COL_TW[1], docxPara(docxRun(kind.isField ? 'KRA' : '', { b: true }), { center: true }), { shade: true }),
            docxCell(COL_TW[2], docxPara(docxRun('ACTIVITIES WITH DETAILS AND PROGRESS', { b: true }), { center: true }), { shade: true })
        ]));

        m.mainGroups.forEach((g) => {
            const dateText = g.dates.map((d) => String(Number(d.slice(8, 10)))).join(', ');
            rows.push(docxRow([
                docxCell(COL_TW[0], docxPara(docxRun(dateText), { center: true }), { vAlign: 'top' }),
                docxCell(COL_TW[1], docxPara(docxRun(kind.isField ? String(g.kra) : ''), { center: true }), { vAlign: 'top' }),
                docxCell(COL_TW[2], (g.activity || '—').split('\n').map((line) =>
                    docxPara(docxRun(line), { left: true })
                ).join(''), { vAlign: 'top' })
            ]));
        });

        // Section 12 as separate table
        const tables = [rows.slice()];

        if (kind.isField) {
            const secRows = [];

            secRows.push(docxRow([
                docxCell(SEC_W, docxPara(docxRun('12. Other than KRA:', { b: true, color: 'FFFFFF' }), { left: true }),
                    { span: 3, shadeBrand: true })
            ]));

            secRows.push(docxRow([
                docxCell(COL_TW_SEC12[0], docxPara(docxRun('DATE', { b: true }), { center: true }), { shade: true }),
                docxCell(COL_TW_SEC12[1], docxPara(docxRun('PLACE AND PURPOSE', { b: true }), { center: true }), { shade: true }),
                docxCell(COL_TW_SEC12[2], docxPara(docxRun('PARTICULARS, PROBLEMS AND HIGHLIGHTS', { b: true }), { center: true }), { shade: true })
            ]));

            if (m.otherEntries.length === 0) {
                secRows.push(docxRow([
                    docxCell(COL_TW_SEC12[0], docxPara(docxRun('—'), { center: true })),
                    docxCell(COL_TW_SEC12[1], docxPara(docxRun('—'), { center: true })),
                    docxCell(COL_TW_SEC12[2], docxPara(docxRun('No entries for this month.'), { center: true }))
                ]));
            } else {
                m.otherEntries.forEach((e) => {
                    secRows.push(docxRow([
                        docxCell(COL_TW_SEC12[0], docxPara(docxRun(String(Number(e.date.slice(8, 10)))), { center: true }), { vAlign: 'top' }),
                        docxCell(COL_TW_SEC12[1], docxPara(docxRun(e.place), { left: true }), { vAlign: 'top' }),
                        docxCell(COL_TW_SEC12[2], (e.activity || '—').split('\n').map((line) =>
                            docxPara(docxRun(line), { left: true })
                        ).join(''), { vAlign: 'top' })
                    ]));
                });
            }

            tables.push(secRows);

            // Praise / prayer as its own 2-column table
            const refRows = [];
            const colW = Math.floor(SEC_W / 2);
            refRows.push(docxRow([
                docxCell(colW, docxPara(docxRun('PRAISING POINTS:', { b: true, color: '075E54' }), { left: true }) +
                    (m.praising.length
                        ? m.praising.map((t, i) => docxPara(docxRun(`${i + 1}. ${t}`), { left: true, hang: true })).join('')
                        : docxPara(docxRun('—'), { left: true })),
                    { vAlign: 'top' }),
                docxCell(colW, docxPara(docxRun('PRAYER POINTS:', { b: true, color: '075E54' }), { left: true }) +
                    (m.prayer.length
                        ? m.prayer.map((t, i) => docxPara(docxRun(`${i + 1}. ${t}`), { left: true, hang: true })).join('')
                        : docxPara(docxRun('—'), { left: true })),
                    { vAlign: 'top' })
            ]));
            tables.push(refRows);
        }

        const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="444444"/>`;
        const borderXml = '<w:tblBorders>' +
            ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('') +
            '</w:tblBorders>';

        const buildTable = (rowsXml, widths) =>
            '<w:tbl><w:tblPr>' +
            `<w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>` +
            borderXml +
            '<w:tblLayout w:type="fixed"/>' +
            `</w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
            rowsXml.join('') + '</w:tbl>';

        const tableMain = buildTable(tables[0], COL_TW);
        const tableSection = kind.isField ? buildTable(tables[1], COL_TW_SEC12) : '';
        const tableReflect = kind.isField
            ? buildTable(tables[2], [Math.floor(SEC_W / 2), Math.ceil(SEC_W / 2)])
            : '';

        const spacer = docxPara('');

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<w:document ' +
            'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
            'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
            'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
            '<w:body>' +
            tableMain + spacer +
            tableSection + (tableSection ? spacer : '') +
            tableReflect +
            docxPara('') +
            '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
            '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>' +
            '</w:sectPr></w:body></w:document>';
    }

    async function exportDocx(m, logo) {
        if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded');

        const zip = new JSZip();
        const ext = logo ? logo.ext : 'jpeg';

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

        zip.file('word/_rels/document.xml.rels',
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
            (logo
                ? `<Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/logo.${ext}"/>`
                : '') +
            '</Relationships>');

        zip.file('word/document.xml', buildDocumentXml(m, logo));
        if (logo) zip.file(`word/media/logo.${ext}`, logo.base64, { base64: true });

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
            await new Promise((r) => setTimeout(r, 50));

            if (type === 'pdf') exportPdf(model, logo);
            if (type === 'excel') exportExcel(model);
            if (type === 'word') await exportDocx(model, logo);
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