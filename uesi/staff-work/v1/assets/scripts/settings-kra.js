// /apps/uesi/staff-work/v1/assets/scripts/settings-kra.js
(() => {
    'use strict';

    const { $, Session, notify, confirm: askConfirm, setLoading } = window.UI;

    const DB_ROOT = 'apps/uesi/staff-work/v1/users';
    const TIMEOUT_MS = 20000;
    const YEAR_SPAN = 2;
    const MAX_KRA = 10;
    const MONTHS = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
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

    const pad = (n) => String(n).padStart(2, '0');

    function withTimeout(promise, ms) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    // Accepts a list (new format) or the older {"1": "...", "2": "..."} object
    function normalizeList(v) {
        if (!v) return [];
        const items = Array.isArray(v)
            ? v
            : Object.keys(v)
                .filter((k) => /^\d+$/.test(k))
                .sort((a, b) => a - b)
                .map((k) => v[k]);
        return items.map((s) => String(s || '').trim()).filter(Boolean);
    }

    let session = null;
    let loadToken = 0;

    /* ---------- Month / year ---------- */
    function fillSelects() {
        const now = new Date();
        $('monthSelect').replaceChildren(
            ...MONTHS.map((name, i) => new Option(name, String(i + 1), false, i === now.getMonth()))
        );
        const y = now.getFullYear();
        const years = [];
        for (let year = y - YEAR_SPAN; year <= y + YEAR_SPAN; year++) years.push(year);
        $('yearSelect').replaceChildren(
            ...years.map((year) => new Option(String(year), String(year), false, year === y))
        );
    }

    /* ---------- Dynamic rows ---------- */
    function makeRow(text = '') {
        const row = document.createElement('div');
        row.className = 'kra-row';
        row.innerHTML =
            '<div class="kra-head">' +
                '<span class="kra-no"></span>' +
                '<button type="button" class="kra-remove ripple" aria-label="Remove this KRA">' +
                    '<i class="fas fa-trash-can"></i>' +
                '</button>' +
            '</div>' +
            '<textarea class="textarea" rows="3" placeholder="Describe the KRA objective"></textarea>';
        row.querySelector('textarea').value = text;
        return row;
    }

    function renumber() {
        const rows = [...$('kraList').children];
        rows.forEach((r, i) => {
            r.querySelector('.kra-no').textContent = `KRA ${i + 1}`;
        });
        $('addKraBtn').disabled = rows.length >= MAX_KRA;
        $('kraCount').textContent = `${rows.length} of ${MAX_KRA} KRA objectives`;
    }

    function setRows(items) {
        const list = items.length ? items : [''];
        $('kraList').replaceChildren(...list.map((t) => makeRow(t)));
        renumber();
    }

    function addRow() {
        if ($('kraList').children.length >= MAX_KRA) return;
        const row = makeRow('');
        $('kraList').append(row);
        renumber();
        row.querySelector('textarea').focus();
    }

    async function removeRow(row) {
        const text = row.querySelector('textarea').value.trim();
        const rows = $('kraList').children.length;

        if (rows === 1) {
            row.querySelector('textarea').value = '';
            return;
        }
        if (text) {
            const ok = await askConfirm({
                title: 'Remove this KRA?',
                text: 'Its text will be removed when you save.',
                tone: 'warning',
                okText: 'Remove'
            });
            if (!ok) return;
        }
        row.remove();
        renumber();
    }

    /* ---------- Load ---------- */
    async function load() {
        if (!session) return;

        const token = ++loadToken;
        const year = $('yearSelect').value;
        const month = pad($('monthSelect').value);
        const safeEmail = session.email.replace(/\./g, '_');
        const path = `${DB_ROOT}/${safeEmail}/userData/KRA_Objectives/${year}/${month}`;

        $('loadState').hidden = false;
        try {
            const snap = await withTimeout(db.ref(path).once('value'), TIMEOUT_MS);
            if (token !== loadToken) return;
            setRows(normalizeList(snap.val()));
        } catch (err) {
            if (token !== loadToken) return;
            console.error('KRA load failed:', err);
            notify('Could not load the KRA objectives. Please try again.', 'error');
        } finally {
            if (token === loadToken) $('loadState').hidden = true;
        }
    }

    /* ---------- Save ---------- */
    async function onSubmit(e) {
        e.preventDefault();
        if (!session) {
            notify('Please login first.', 'error');
            return;
        }

        const year = $('yearSelect').value;
        const month = pad($('monthSelect').value);
        const monthName = MONTHS[Number(month) - 1];
        const list = [...$('kraList').querySelectorAll('textarea')]
            .map((t) => t.value.trim())
            .filter(Boolean);

        if (list.length === 0) {
            const ok = await askConfirm({
                title: `Clear ${monthName} ${year}?`,
                text: 'No KRA objectives will be shown on the report for this month.',
                tone: 'warning',
                okText: 'Clear'
            });
            if (!ok) return;
        }

        const safeEmail = session.email.replace(/\./g, '_');
        const path = `${DB_ROOT}/${safeEmail}/userData/KRA_Objectives/${year}/${month}`;

        const btn = e.target.querySelector('.submit-btn');
        setLoading(btn, true, 'Saving…');
        try {
            await withTimeout(db.ref(path).set(list.length ? list : null), TIMEOUT_MS);
            setRows(list);
            notify(
                list.length
                    ? `${list.length} KRA objective${list.length > 1 ? 's' : ''} saved for ${monthName} ${year}.`
                    : `KRA objectives cleared for ${monthName} ${year}.`,
                'success',
                'Saved'
            );
        } catch (err) {
            console.error('KRA save failed:', err);
            notify(
                err.message === 'timeout'
                    ? 'No response from the server. Check your connection and try again.'
                    : 'Could not save. Please try again.',
                'error'
            );
        } finally {
            setLoading(btn, false);
        }
    }

    /* ---------- Boot ---------- */
    $('backBtn').addEventListener('click', () => {
        if (history.length > 1) history.back();
        else location.href = Session.HOME_URL;
    });
    $('loginBtn').addEventListener('click', () => Session.login());
    $('monthSelect').addEventListener('change', load);
    $('yearSelect').addEventListener('change', load);
    $('addKraBtn').addEventListener('click', addRow);
    $('kraList').addEventListener('click', (e) => {
        const btn = e.target.closest('.kra-remove');
        if (btn) removeRow(btn.closest('.kra-row'));
    });
    $('kraForm').addEventListener('submit', onSubmit);

    fillSelects();
    setRows([]);

    Session.watch((s) => {
        const body = document.body;
        body.classList.remove('auth-pending', 'is-authed', 'is-guest');
        body.classList.add(s ? 'is-authed' : 'is-guest');

        const changed = (s?.email || null) !== (session?.email || null);
        session = s;
        if (changed && s) load();
    });
})();