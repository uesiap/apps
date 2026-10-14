// /apps/uesi/staff-work/v1/assets/scripts/settings-reflection.js
(() => {
    'use strict';

    const { $, Session, notify, setLoading } = window.UI;

    const DB_ROOT = 'apps/uesi/staff-work/v1/users';
    const TIMEOUT_MS = 20000;
    const YEAR_SPAN = 2;
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

    const toPoints = (v) => {
        if (Array.isArray(v)) return v.filter(Boolean).map(String);
        if (typeof v === 'string') {
            return v.split('\n').map((l) => l.trim().replace(/^\d+[.)]\s*/, '')).filter(Boolean);
        }
        return [];
    };

    const fromPoints = (arr) =>
        arr.map((p, i) => `${i + 1}. ${p}`).join('\n');

    let session = null;
    let loadToken = 0;

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

    async function load() {
        if (!session) return;

        const token = ++loadToken;
        const year = $('yearSelect').value;
        const month = $('monthSelect').value;
        if (!year || !month) return;

        const safeEmail = session.email.replace(/\./g, '_');
        const path =
            `${DB_ROOT}/${safeEmail}/userData/Monthly_Reflection/${year}/${pad(month)}`;

        try {
            const snap = await withTimeout(db.ref(path).once('value'), TIMEOUT_MS);
            if (token !== loadToken) return;

            const data = snap.val() || {};
            $('praising').value = fromPoints(toPoints(data.praising || []));
            $('prayer').value = fromPoints(toPoints(data.prayer || []));
        } catch (err) {
            if (token !== loadToken) return;
            console.error('Reflection load failed:', err);
            notify('Could not load the reflection. Please try again.', 'error');
        }
    }

    function parsePoints(raw) {
        return raw
            .split('\n')
            .map((line) => line.trim().replace(/^\d+[.)]\s*/, '').replace(/^[*\-•]\s*/, ''))
            .filter(Boolean);
    }

    async function onSubmit(e) {
        e.preventDefault();

        if (!session) {
            notify('Please login first.', 'error');
            return;
        }

        const year = $('yearSelect').value;
        const month = pad($('monthSelect').value);

        const praising = parsePoints($('praising').value);
        const prayer = parsePoints($('prayer').value);

        if (praising.length === 0 && prayer.length === 0) {
            notify('Please enter at least one point.', 'error');
            return;
        }

        const safeEmail = session.email.replace(/\./g, '_');
        const path =
            `${DB_ROOT}/${safeEmail}/userData/Monthly_Reflection/${year}/${month}`;

        const btn = e.target.querySelector('.submit-btn');
        setLoading(btn, true, 'Saving…');
        try {
            await withTimeout(db.ref(path).set({ praising, prayer }), TIMEOUT_MS);
            notify('Reflection saved.', 'success', 'Saved');
        } catch (err) {
            console.error('Reflection save failed:', err);
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
    $('reflectionForm').addEventListener('submit', onSubmit);

    fillSelects();

    Session.watch((s) => {
        const body = document.body;
        body.classList.remove('auth-pending', 'is-authed', 'is-guest');
        body.classList.add(s ? 'is-authed' : 'is-guest');

        const changed = (s?.email || null) !== (session?.email || null);
        session = s;
        if (changed && s) load();
    });
})();