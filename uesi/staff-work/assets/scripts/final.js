
(() => {
    'use strict';

    const { $, Session, notify, setLoading } = window.UI;

    const KINDS = {
        field: { path: 'Field_Report', title: 'FIELD REPORT', label: 'Field Report', sheet: 'Field Report', dayHead: 'Day' },
        itinerary: { path: 'Itinerary_Form', title: 'ITINERARY', label: 'Itinerary Report', sheet: 'Itinerary Report', dayHead: 'DAY' }
    };
    const kind = KINDS[document.body.dataset.kind] || KINDS.field;

    const DB_ROOT = 'apps/uesi/staff-work/users';
    const LOGO = 'https://uesiap.github.io/vidhyarthi-geethavali/assets/Icons/uesi192.jpg';
    const SPECIAL_WORDS = ['day off', 'preparation', 'holidays', 'leave', 'sick'];
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const LOAD_TIMEOUT_MS = 20000;
    const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const MONTHS = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const COLS = ['Sl. No', 'Date', kind.dayHead, 'Zone / Division', 'Purpose'];

    // Column widths: preview (percent), PDF (mm, total 182), Word (twips, total 10466)
    const COL_PCT = ['9%', '12%', '13%', '18%', '48%'];
    const COL_MM = [14, 20, 22, 30, 96];
    const COL_TW = [900, 1250, 1300, 1900, 5116];

    const LOGO_MM = 12;        // logo size in PDF
    const LOGO_EMU = 548640;   // logo size in Word (0.6 inch)
    const NAME_GAP = '            ';

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

    const staffLine = (m, gap) => `NAME: ${m.name}${gap}Base: ${m.base}`;
    const brandText = (m) => `Union of Evangelical Students of India - ${m.state}`;
    const fileBase = (m) => safeName(`${m.name} ${kind.label} - ${m.monthName} ${m.year}`);

    /* ---------- Logo (fetched once, reused by PDF and Word) ---------- */
    let logoPromise = null;

    function loadLogo() {
        if (!logoPromise) {
            logoPromise = fetch(LOGO, { cache: 'force-cache' })
                .then((r) => {
                    if (!r.ok) throw new Error('logo request failed');
                    return r.blob();
                })
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
                    console.warn('Logo unavailable for export:', err);
                    return null;
                });
        }
        return logoPromise;
    }

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
    function buildColgroup() {
        const cg = el('colgroup');
        COL_PCT.forEach((w) => {
            const c = el('col');
            c.style.width = w;
            cg.append(c);
        });
        return cg;
    }

    function buildHead(m) {
        const brand = el('div', 'rpt-brand');
        const logo = el('img', 'rpt-logo');
        logo.src = LOGO;
        logo.alt = '';
        brand.append(logo, el('span', '', brandText(m)));

        const brandCell = el('td');
        brandCell.colSpan = 5;
        brandCell.append(brand);

        const staff = el('div', 'rpt-staff-line');
        staff.append(el('span', '', `NAME: ${m.name}`), el('span', '', `Base: ${m.base}`));

        const staffCell = el('td');
        staffCell.colSpan = 5;
        staffCell.append(staff);

        const thead = el('thead');
        thead.append(
            tr('rpt-main', [brandCell]),
            tr('rpt-title', [cell(m.title, 5)]),
            tr('rpt-staff', [staffCell]),
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
        table.append(buildColgroup(), buildHead(m), buildBody(m.rows));

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
    function exportPdf(m, logo) {
        if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('jsPDF not loaded');

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        doc.setFont('times', 'normal');
        doc.setFontSize(9);

        const PAD = 2;
        const PURPOSE_W = COL_MM[4];

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
            // Brand row is empty here; the logo and text are drawn in didDrawCell
            [{ content: '', colSpan: 5, styles: { minCellHeight: 16 } }],
            [{ content: m.title, colSpan: 5, styles: { fontSize: 15, fontStyle: 'bold', textColor: [7, 94, 84] } }],
            [{ content: staffLine(m, NAME_GAP), colSpan: 5, styles: { fontSize: 12, fontStyle: 'bold' } }],
            COLS.map((c) => ({ content: c, styles: { fontSize: 10, fontStyle: 'bold', fillColor: [242, 242, 242] } }))
        ];

        const columnStyles = {};
        COL_MM.forEach((w, i) => {
            columnStyles[i] = { cellWidth: w };
        });
        columnStyles[4].halign = 'left';

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
            columnStyles,
            rowPageBreak: 'avoid',
            didDrawCell(data) {
                if (data.section !== 'head' || data.row.index !== 0 || data.column.index !== 0) return;

                const text = brandText(m);
                doc.setFont('times', 'bold');
                doc.setFontSize(12);
                doc.setTextColor(0, 0, 0);

                const gap = 3;
                const textW = doc.getTextWidth(text);
                const total = logo ? LOGO_MM + gap + textW : textW;
                const x0 = data.cell.x + (data.cell.width - total) / 2;
                const cy = data.cell.y + data.cell.height / 2;

                if (logo) {
                    doc.addImage(logo.dataUrl, logo.fmt, x0, cy - LOGO_MM / 2, LOGO_MM, LOGO_MM);
                }
                doc.text(text, x0 + (logo ? LOGO_MM + gap : 0), cy, { baseline: 'middle' });
            }
        });

        doc.save(`${fileBase(m)}.pdf`);
    }

    /* ---------- Excel ---------- */
    function exportExcel(m) {
        if (typeof XLSX === 'undefined') throw new Error('SheetJS not loaded');

        const aoa = [
            [brandText(m)],
            [m.title],
            [staffLine(m, NAME_GAP)],
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
        ws['!rows'] = [{ hpt: 44 }, { hpt: 30 }, { hpt: 26 }];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, kind.sheet);
        XLSX.writeFile(wb, `${fileBase(m)}.xlsx`);
    }

    /* ---------- Word (.docx built directly, so Word opens it cleanly) ---------- */
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
            '</w:pPr>' + runs + '</w:p>';
    }

    function docxCell(width, paragraphs, o = {}) {
        let tcPr = `<w:tcW w:w="${width}" w:type="dxa"/>`;
        if (o.span) tcPr += `<w:gridSpan w:val="${o.span}"/>`;
        if (o.vm === 'restart') tcPr += '<w:vMerge w:val="restart"/>';
        if (o.vm === 'cont') tcPr += '<w:vMerge/>';
        if (o.shade) tcPr += '<w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>';
        tcPr += '<w:vAlign w:val="center"/>';
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
        const TEXT_W = COL_TW.reduce((a, b) => a + b, 0);
        const grid = COL_TW.map((w) => `<w:gridCol w:w="${w}"/>`).join('');

        const brandRuns = (logo ? docxLogoRun(logo) + docxRun('  ') : '') +
            docxRun(brandText(m), { b: true, sz: 24 });

        const rows = [];

        rows.push(docxRow([
            docxCell(TEXT_W, docxPara(brandRuns, { center: true }), { span: 5 })
        ], { height: 900 }));

        rows.push(docxRow([
            docxCell(TEXT_W, docxPara(docxRun(m.title, { b: true, sz: 30, color: '075E54' }), { center: true }), { span: 5 })
        ]));

        rows.push(docxRow([
            docxCell(TEXT_W, docxPara(docxRun(staffLine(m, NAME_GAP), { b: true, sz: 24 }), { center: true }), { span: 5 })
        ]));

        rows.push(docxRow(COLS.map((c, i) =>
            docxCell(COL_TW[i], docxPara(docxRun(c, { b: true }), { center: true }), { shade: true })
        )));

        m.rows.forEach((row) => {
            const cells = [
                docxCell(COL_TW[0], docxPara(docxRun(String(row.sl)), { center: true })),
                docxCell(COL_TW[1], docxPara(docxRun(fmtDate(row.date)), { center: true })),
                docxCell(COL_TW[2], docxPara(docxRun(row.day), { center: true }))
            ];

            if (row.span > 0) {
                cells.push(
                    docxCell(COL_TW[3], docxPara(docxRun(row.zone), { center: true }), { vm: 'restart' }),
                    docxCell(
                        COL_TW[4],
                        row.purpose.map((p, i) =>
                            docxPara(docxRun(`${i + 1}.`) + '<w:r><w:tab/></w:r>' + docxRun(p), { hang: true })
                        ).join('') || docxPara(''),
                        { vm: 'restart' }
                    )
                );
            } else {
                cells.push(
                    docxCell(COL_TW[3], docxPara(''), { vm: 'cont' }),
                    docxCell(COL_TW[4], docxPara(''), { vm: 'cont' })
                );
            }
            rows.push(docxRow(cells));
        });

        const border = (side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="444444"/>`;
        const table = '<w:tbl><w:tblPr>' +
            `<w:tblW w:w="${TEXT_W}" w:type="dxa"/>` +
            '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('') + '</w:tblBorders>' +
            '<w:tblLayout w:type="fixed"/>' +
            `</w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rows.join('')}</w:tbl>`;

        return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<w:document ' +
            'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
            'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
            'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
            'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
            '<w:body>' + table + docxPara('') +
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
        setLoading(btn, true, 'Preparing...');

        try {
            const logo = await loadLogo();
            await new Promise((r) => setTimeout(r, 50)); // let the spinner paint

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

    loadLogo(); // start fetching the logo early so exports are ready
    Session.watch(onAuth);
})();