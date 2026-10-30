// /apps/uesi/staff-work/v1/assets/scripts/view.js
// Lists saved field reports and itinerary entries.
// <body data-kind="field|itinerary"> chooses the labels and fields.
(() => {
    'use strict';

    const { $, Session, notify, confirm: askConfirm, setLoading } = window.UI;

    const KINDS = {
        field:     { path: 'Field_Report',   isField: true },
        itinerary: { path: 'Itinerary_Form', isField: false }
    };
    const kind = KINDS[document.body.dataset.kind] || KINDS.field;

    const DB_ROOT = 'apps/uesi/staff-work/v1/users';
    const SAVE_TIMEOUT_MS = 20000;
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    const MONTHS = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const KRA_OPTIONS = [
        ['1', '1 — First KRA'],
        ['2', '2 — Second KRA'],
        ['3', '3 — Third KRA'],
        ['4', '4 — Fourth KRA'],
        ['5', '5 — Fifth KRA'],
        ['0', 'Other than KRA (Section 12)']
    ];

    if (!firebase.apps.length) {
        firebase.initializeApp({
            apiKey: '0AzyPiDT3wSi6WAuNX7YzbyJcvUgV0nyoxMwahn0',
            authDomain: 'uesi-ap-default-rtdb.firebaseio.com',
            databaseURL: 'https://uesi-ap-default-rtdb.firebaseio.com',
            projectId: 'uesi-ap'
        });
    }
    const db = firebase.database();

    const state = {
        entries: [],
        ref: null,
        listeningKey: null,
        loaded: false,
        error: false,
        filtersReady: false,
        editingId: null
    };

    /* ---------- DOM helpers ---------- */
    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }
    function faIcon(name) {
        const i = el('i');
        i.className = `fas ${name}`;
        return i;
    }
    function actionBtn(act, label, variant, icon) {
        const b = el('button', `btn btn-sm ripple ${variant}`);
        b.type = 'button';
        b.dataset.act = act;
        b.append(faIcon(icon), el('span', '', label));
        return b;
    }
    function labelled(text, control, id) {
        const wrap = el('div', 'field');
        const label = el('label', 'label', text);
        label.htmlFor = id;
        control.id = id;
        wrap.append(label, control);
        return wrap;
    }

    /* ---------- Data helpers ---------- */
    const monthIndexOf = (ymd) => Number(ymd.slice(5, 7)) - 1;
    const yearOf = (ymd) => Number(ymd.slice(0, 4));
    const fmtDate = (ymd) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
    const weekdayOf = (ymd) =>
        new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });

    function withTimeout(promise, ms) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    function parseSnapshot(snap) {
        const out = [];
        snap.forEach((yearSnap) => {
            yearSnap.forEach((monthSnap) => {
                monthSnap.forEach((daySnap) => {
                    const date = daySnap.key;
                    const val = daySnap.val();
                    if (!DATE_RE.test(date) || !val || typeof val !== 'object') return;
                    out.push({
                        id: `${yearSnap.key}/${monthSnap.key}/${date}`,
                        date,
                        day: val.day || weekdayOf(date),
                        kra: kind.isField ? Number(val.kra ?? 0) : null,
                        // Older itinerary entries stored the place as "zone"
                        place: String(val.place || val.zone || '').trim(),
                        activity: String(val.activity || '').trim()
                    });
                });
            });
        });
        out.sort((a, b) => a.date.localeCompare(b.date));
        return out;
    }

    /* ---------- Filters ---------- */
    function fillSelect(select, options) {
        select.replaceChildren(...options.map(([value, label]) => new Option(label, value)));
    }

    function syncFilters() {
        const monthSel = $('monthSelect');
        const yearSel = $('yearSelect');
        const prevM = monthSel.value;
        const prevY = yearSel.value;

        const months = [...new Set(state.entries.map((e) => monthIndexOf(e.date)))].sort((a, b) => a - b);
        const years = [...new Set(state.entries.map((e) => yearOf(e.date)))].sort((a, b) => b - a);

        fillSelect(monthSel, [['', 'All months'], ...months.map((m) => [String(m), MONTHS[m]])]);
        fillSelect(yearSel, [['', 'All years'], ...years.map((y) => [String(y), String(y)])]);

        monthSel.value = prevM !== '' && months.includes(Number(prevM)) ? prevM : '';
        yearSel.value = prevY !== '' && years.includes(Number(prevY)) ? prevY : '';
    }

    function pickDefaults() {
        const now = new Date();
        const m = now.getMonth();
        const y = now.getFullYear();
        const hasCurrent = state.entries.some(
            (e) => yearOf(e.date) === y && monthIndexOf(e.date) === m
        );

        let target = null;
        if (hasCurrent) target = { m, y };
        else if (state.entries.length) {
            const last = state.entries[state.entries.length - 1];
            target = { m: monthIndexOf(last.date), y: yearOf(last.date) };
        }
        if (target) {
            $('monthSelect').value = String(target.m);
            $('yearSelect').value = String(target.y);
        }
    }

    function visibleEntries() {
        const m = $('monthSelect').value;
        const y = $('yearSelect').value;
        return state.entries.filter((e) =>
            (y === '' || yearOf(e.date) === Number(y)) &&
            (m === '' || monthIndexOf(e.date) === Number(m))
        );
    }

    /* ---------- Card builders ---------- */
    function buildHead(entry) {
        const dd = entry.date.slice(8, 10);
        const mon = MONTHS[monthIndexOf(entry.date)].slice(0, 3);

        const date = el('div', 'entry-date');
        date.append(el('span', 'entry-dd', dd), el('span', 'entry-mon', mon));

        const meta = el('div', 'entry-meta');
        meta.append(el('strong', '', entry.day), el('span', '', fmtDate(entry.date)));

        const head = el('header', 'entry-head');
        head.append(date, meta);

        if (kind.isField) {
            const kra = el('span', `entry-kra${entry.kra === 0 ? ' other' : ''}`,
                entry.kra === 0 ? 'Other' : `KRA ${entry.kra}`);
            head.append(kra);
        }
        return head;
    }

    function buildBody(entry) {
        const body = el('div', 'entry-body');
        body.style.display = 'flex';
        body.style.flexDirection = 'column';
        body.style.gap = '12px';

        if (entry.place) {
            const place = el('div', 'entry-place');
            place.append(
                faIcon(kind.isField ? 'fa-location-dot' : 'fa-map-pin'),
                el('span', '', entry.place)
            );
            body.append(place);
        }

        if (entry.activity) {
            body.append(el('p', 'entry-activity', entry.activity));
        }
        return body;
    }

    function buildActions() {
        const bar = el('footer', 'entry-actions');
        bar.append(
            actionBtn('edit', 'Edit', 'btn-outline', 'fa-pen'),
            actionBtn('delete', 'Delete', 'btn-danger', 'fa-trash')
        );
        return bar;
    }

    function buildEditor(entry) {
        const uid = Math.random().toString(36).slice(2, 8);
        const form = el('form', 'entry-editor');
        form.noValidate = true;

        const controls = [];

        if (kind.isField) {
            const kraWrap = el('div', 'field');
            const kraLabel = el('label', 'label', 'KRA');
            const kraSel = el('select', 'select');
            kraSel.name = 'kra';
            kraSel.id = `kra-${uid}`;
            kraLabel.htmlFor = kraSel.id;
            KRA_OPTIONS.forEach(([v, l]) => kraSel.append(new Option(l, v)));
            kraSel.value = String(entry.kra);
            kraWrap.append(kraLabel, kraSel);
            controls.push(kraWrap);
        }

        // One place field for both reports
        const place = el('input', 'input');
        place.type = 'text';
        place.name = 'place';
        place.value = entry.place;
        controls.push(labelled('Place & Purpose', place, `place-${uid}`));

        const activity = el('textarea', 'textarea');
        activity.name = 'activity';
        activity.rows = 5;
        activity.value = entry.activity;
        controls.push(labelled('Activity details', activity, `activity-${uid}`));

        const save = el('button', 'btn btn-primary ripple');
        save.type = 'submit';
        save.append(faIcon('fa-check'), el('span', '', 'Save'));

        const actions = el('div', 'entry-actions');
        actions.append(actionBtn('cancel', 'Cancel', 'btn-outline', 'fa-xmark'), save);

        form.append(...controls, actions);
        return form;
    }

    function buildCard(entry) {
        const card = el('article', 'card entry');
        card.dataset.id = entry.id;
        card.append(buildHead(entry));

        if (state.editingId === entry.id) {
            card.append(buildEditor(entry));
        } else {
            card.append(buildBody(entry), buildActions());
        }
        return card;
    }

    /* ---------- Render ---------- */
    function render() {
        const entries = visibleEntries();
        const list = $('list');
        const hasAny = state.entries.length > 0;

        $('loadState').hidden = state.loaded;
        $('errorState').hidden = !state.error;
        $('emptyState').hidden = !(state.loaded && !state.error && !hasAny);
        $('noMatch').hidden = !(state.loaded && !state.error && hasAny && entries.length === 0);
        list.hidden = !(state.loaded && !state.error && entries.length > 0);

        list.replaceChildren(...(list.hidden ? [] : entries.map(buildCard)));

        $('summary').textContent = list.hidden
            ? ''
            : `${entries.length} ${entries.length === 1 ? 'day' : 'days'} recorded`;

        $('deleteMonthBtn').disabled =
            !state.loaded || !$('monthSelect').value || !$('yearSelect').value;
    }

    /* ---------- Data listener ---------- */
    function attach(session) {
        const key = session ? session.email : null;
        if (key === state.listeningKey) return;

        if (state.ref) state.ref.off();
        state.ref = null;
        state.entries = [];
        state.loaded = false;
        state.error = false;
        state.filtersReady = false;
        state.editingId = null;
        state.listeningKey = key;

        if (!session) {
            render();
            return;
        }

        const safeEmail = session.email.replace(/\./g, '_');
        state.ref = db.ref(`${DB_ROOT}/${safeEmail}/userData/${kind.path}`);

        state.ref.on(
            'value',
            (snap) => {
                state.entries = parseSnapshot(snap);
                state.loaded = true;
                state.error = false;

                syncFilters();
                if (!state.filtersReady) {
                    pickDefaults();
                    state.filtersReady = true;
                }
                render();
            },
            (err) => {
                console.error('Read failed:', err);
                state.loaded = true;
                state.error = true;
                render();
            }
        );

        render();
    }

    function renderAuth(session) {
        const body = document.body;
        body.classList.remove('auth-pending', 'is-authed', 'is-guest');
        body.classList.add(session ? 'is-authed' : 'is-guest');
        attach(session);
    }

    /* ---------- Edit / save / delete ---------- */
    function onListClick(e) {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;

        const card = btn.closest('.entry');
        const id = card.dataset.id;
        const act = btn.dataset.act;

        if (act === 'edit') {
            state.editingId = id;
            render();
            $('list')
                .querySelector(`[data-id="${CSS.escape(id)}"] textarea[name="activity"]`)
                ?.focus();
        }

        if (act === 'cancel') {
            state.editingId = null;
            render();
        }

        if (act === 'delete') {
            removeEntry(id);
        }
    }

    function onListSubmit(e) {
        if (!e.target.classList.contains('entry-editor')) return;
        e.preventDefault();
        saveEntry(e.target);
    }

    async function saveEntry(form) {
        const id = form.closest('.entry').dataset.id;
        const activity = form.elements.activity.value.trim();
        const place = form.elements.place.value.trim();

        if (!activity) {
            notify('Please describe the activity.', 'error');
            return;
        }

        let payload;
        if (kind.isField) {
            const kra = Number(form.elements.kra.value);
            if (kra === 0 && !place) {
                notify('Please enter the place for an "Other than KRA" entry.', 'error');
                return;
            }
            payload = { kra, place, activity };
        } else {
            if (!place) {
                notify('Please enter the place & purpose.', 'error');
                return;
            }
            payload = { place, activity };
        }

        const btn = form.querySelector('[type="submit"]');
        setLoading(btn, true, 'Saving…');

        try {
            await withTimeout(state.ref.child(id).update(payload), SAVE_TIMEOUT_MS);
            state.editingId = null;
            notify('Your changes have been saved.', 'success', 'Updated');

            const entry = state.entries.find((x) => x.id === id);
            if (entry) Object.assign(entry, payload);
            render();
        } catch (err) {
            console.error('Save failed:', err);
            setLoading(btn, false);
            notify(
                err.message === 'timeout'
                    ? 'No response from the server. Check your connection and try again.'
                    : 'Could not save your changes. Please try again.',
                'error'
            );
        }
    }

    async function removeEntry(id) {
        const entry = state.entries.find((x) => x.id === id);
        if (!entry) return;

        const ok = await askConfirm({
            title: 'Delete this entry?',
            text: `${fmtDate(entry.date)} will be removed. This cannot be undone.`,
            tone: 'error',
            okText: 'Delete'
        });
        if (!ok) return;

        try {
            await withTimeout(state.ref.child(id).remove(), SAVE_TIMEOUT_MS);
            notify('The entry has been deleted.', 'success', 'Deleted');
        } catch (err) {
            console.error('Delete failed:', err);
            notify('Could not delete the entry. Please try again.', 'error');
        }
    }

    async function deleteMonth() {
        if (!state.ref) return;

        const m = Number($('monthSelect').value);
        const y = Number($('yearSelect').value);
        const items = state.entries.filter(
            (e) => yearOf(e.date) === y && monthIndexOf(e.date) === m
        );

        if (items.length === 0) {
            notify('No entries were found for that month.', 'info');
            return;
        }

        const ok = await askConfirm({
            title: `Delete ${MONTHS[m]} ${y}?`,
            text: `All ${items.length} ${items.length === 1 ? 'entry' : 'entries'} for this month will be removed. This cannot be undone.`,
            tone: 'error',
            okText: 'Delete all'
        });
        if (!ok) return;

        const updates = {};
        items.forEach((e) => { updates[e.id] = null; });

        try {
            await withTimeout(state.ref.update(updates), SAVE_TIMEOUT_MS);
            notify(`${MONTHS[m]} ${y} has been deleted.`, 'success', 'Deleted');
        } catch (err) {
            console.error('Month delete failed:', err);
            notify('Could not delete the month. Please try again.', 'error');
        }
    }

    /* ---------- Boot ---------- */
    $('backBtn').addEventListener('click', () => {
        if (history.length > 1) history.back();
        else location.href = Session.HOME_URL;
    });
    $('loginBtn').addEventListener('click', () => Session.login());
    $('retryBtn').addEventListener('click', () => {
        state.listeningKey = null;
        attach(Session.read());
    });
    $('monthSelect').addEventListener('change', render);
    $('yearSelect').addEventListener('change', render);
    $('deleteMonthBtn').addEventListener('click', deleteMonth);
    $('list').addEventListener('click', onListClick);
    $('list').addEventListener('submit', onListSubmit);

    Session.watch(renderAuth);
})();