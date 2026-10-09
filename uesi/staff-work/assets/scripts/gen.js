
(() => {
    'use strict';

    const { $, Session, notify, setLoading } = window.UI;

    const TARGETS = {
        field: '/apps/uesi/staff-work/gen/final/field-report',
        itinerary: '/apps/uesi/staff-work/gen/final/itinerary'
    };

    const BASE_KEY = 'reportBase';
    const STATE_KEY = 'reportState';
    const YEAR_SPAN = 2;
    const MONTHS = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const target = TARGETS[document.body.dataset.kind] || TARGETS.field;

    /* ---------- Auth ---------- */
    function renderAuth(session) {
        const body = document.body;
        body.classList.remove('auth-pending', 'is-authed', 'is-guest');
        body.classList.add(session ? 'is-authed' : 'is-guest');

        $('staffName').value = session ? session.name : '';
        $('staffEmail').value = session ? session.email : '';
    }

    /* ---------- Month and year options ---------- */
    function fillDateSelects() {
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

    /* ---------- Saved base and state ---------- */
    function restoreSaved() {
        $('baseInput').value = localStorage.getItem(BASE_KEY) || '';
        $('stateInput').value = localStorage.getItem(STATE_KEY) || '';
    }

    function persist(id, key) {
        $(id).addEventListener('input', (e) => {
            try {
                localStorage.setItem(key, e.target.value);
            } catch (_) { /* storage unavailable, ignore */ }
        });
    }

    /* ---------- Submit ---------- */
    function onSubmit(e) {
        e.preventDefault();

        const session = Session.read();
        if (!session) {
            notify('Please login to generate a report.', 'error');
            return;
        }

        const values = {
            name: session.name,
            email: session.email,
            base: $('baseInput').value.trim(),
            state: $('stateInput').value.trim(),
            month: $('monthSelect').value,
            year: $('yearSelect').value
        };

        if (!values.base || !values.state) {
            notify('Please enter your base and state.', 'error');
            return;
        }

        const query = Object.entries(values)
            .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
            .join('&');

        const btn = e.target.querySelector('.submit-btn');
        setLoading(btn, true, 'Generating...');
        window.location.href = `${target}?${query}`;
    }

    /* ---------- Boot ---------- */
    $('backBtn').addEventListener('click', () => {
        if (history.length > 1) history.back();
        else location.href = '/apps/uesi/staff-work/';
    });
    $('loginBtn').addEventListener('click', () => Session.login());
    $('reportForm').addEventListener('submit', onSubmit);

    // If the browser restores this page from history, clear the loading state
    window.addEventListener('pageshow', () => {
        setLoading($('reportForm').querySelector('.submit-btn'), false);
    });

    fillDateSelects();
    restoreSaved();
    persist('baseInput', BASE_KEY);
    persist('stateInput', STATE_KEY);
    Session.watch(renderAuth);
})();