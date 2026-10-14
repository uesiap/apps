// /apps/uesi/staff-work/v1/assets/scripts/gen.js
(() => {
    'use strict';

    const { $, Session, notify, setLoading } = window.UI;

    const TARGETS = {
        field:     '/apps/uesi/staff-work/v1/gen/final/field-report',
        itinerary: '/apps/uesi/staff-work/v1/gen/final/itinerary'
    };

    const BASE_KEY = 'reportBase_v1';
    const REGION_KEY = 'reportRegion_v1';
    const YEAR_SPAN = 2;
    const DB_ROOT = 'apps/uesi/staff-work/v1/users';
    const TIMEOUT_MS = 15000;
    const MONTHS = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const kind = document.body.dataset.kind === 'itinerary' ? 'itinerary' : 'field';
    const target = TARGETS[kind];
    const pad = (n) => String(n).padStart(2, '0');

    if (!firebase.apps.length) {
        firebase.initializeApp({
            apiKey: '0AzyPiDT3wSi6WAuNX7YzbyJcvUgV0nyoxMwahn0',
            authDomain: 'uesi-ap-default-rtdb.firebaseio.com',
            databaseURL: 'https://uesi-ap-default-rtdb.firebaseio.com',
            projectId: 'uesi-ap'
        });
    }
    const db = firebase.database();

    let session = null;
    let reflectionLoaded = false;

    function withTimeout(promise, ms) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    /* ---------- Auth ---------- */
    function renderAuth(s) {
        const body = document.body;
        body.classList.remove('auth-pending', 'is-authed', 'is-guest');
        body.classList.add(s ? 'is-authed' : 'is-guest');

        session = s;
        $('staffName').value = s ? s.name : '';
        $('staffEmail').value = s ? s.email : '';

        if (s && kind === 'field') {
            checkKraHint();
            loadReflection();
        }
    }

    /* ---------- Month / Year ---------- */
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

    /* ---------- Saved base / region ---------- */
    function restoreSaved() {
        $('baseInput').value = localStorage.getItem(BASE_KEY) || '';
        $('regionInput').value = localStorage.getItem(REGION_KEY) || '';
    }
    function persist(id, key) {
        $(id).addEventListener('input', (e) => {
            try { localStorage.setItem(key, e.target.value); } catch (_) {}
        });
    }

    /* ---------- KRA hint ---------- */
    async function checkKraHint() {
        if (!session) return;
        const year = $('yearSelect').value;
        if (!year) return;

        const safeEmail = session.email.replace(/\./g, '_');
        const path = `${DB_ROOT}/${safeEmail}/userData/KRA_Objectives/${year}`;

        try {
            const snap = await withTimeout(db.ref(path).once('value'), TIMEOUT_MS);
            const data = snap.val() || {};
            const hasAny = Object.values(data).some((v) => String(v || '').trim());
            $('kraHint').hidden = hasAny;
            $('kraHintYear').textContent = year;
        } catch {
            $('kraHint').hidden = true;
        }
    }

    /* ---------- Reflection (Praise / Prayer) ---------- */
    function parsePoints(raw) {
        return String(raw || '')
            .split('\n')
            .map((line) => line.trim().replace(/^\d+[.)]\s*/, '').replace(/^[*\-•]\s*/, ''))
            .filter(Boolean);
    }

    const toPointLines = (arr) => arr.map((p, i) => `${i + 1}. ${p}`).join('\n');

    let reflectionData = { praising: [], prayer: [] };

    async function loadReflection() {
        if (!session || kind !== 'field') return;
        reflectionLoaded = false;

        const year = $('yearSelect').value;
        const month = pad($('monthSelect').value);
        if (!year || !month) return;

        const safeEmail = session.email.replace(/\./g, '_');
        const path = `${DB_ROOT}/${safeEmail}/userData/Monthly_Reflection/${year}/${month}`;

        try {
            const snap = await withTimeout(db.ref(path).once('value'), TIMEOUT_MS);
            const data = snap.val() || {};
            reflectionData = {
                praising: Array.isArray(data.praising) ? data.praising : [],
                prayer: Array.isArray(data.prayer) ? data.prayer : []
            };
            renderReflection();
            reflectionLoaded = true;
        } catch (err) {
            console.error('Reflection load failed:', err);
            reflectionData = { praising: [], prayer: [] };
            renderReflection();
        }
    }

    function renderReflection() {
        const hasAny =
            reflectionData.praising.length > 0 || reflectionData.prayer.length > 0;

        $('reflectionCard').hidden = false;
        $('reflectionEditor').hidden = hasAny;
        $('reflectionSummary').hidden = !hasAny;

        if (hasAny) {
            const pList = $('reflectionPraisingList');
            const rList = $('reflectionPrayerList');
            pList.replaceChildren(
                ...(reflectionData.praising.length
                    ? reflectionData.praising.map((t) => {
                        const li = document.createElement('li');
                        li.textContent = t;
                        return li;
                    })
                    : [Object.assign(document.createElement('li'), { textContent: '—' })])
            );
            rList.replaceChildren(
                ...(reflectionData.prayer.length
                    ? reflectionData.prayer.map((t) => {
                        const li = document.createElement('li');
                        li.textContent = t;
                        return li;
                    })
                    : [Object.assign(document.createElement('li'), { textContent: '—' })])
            );
            $('reflectionSub').textContent =
                `Saved for ${MONTHS[Number($('monthSelect').value) - 1]} ${$('yearSelect').value}.`;
        } else {
            $('reflectionSub').textContent =
                'No reflection saved for this month yet. Fill it in now — it will be saved with the report.';
        }
    }

    async function saveReflectionIfEdited() {
        if (kind !== 'field') return;

        const praising = parsePoints($('praising').value);
        const prayer = parsePoints($('prayer').value);

        // If the summary is showing, nothing to save
        if ($('reflectionEditor').hidden) return;

        // If both are empty, skip silently
        if (praising.length === 0 && prayer.length === 0) return;

        const year = $('yearSelect').value;
        const month = pad($('monthSelect').value);
        const safeEmail = session.email.replace(/\./g, '_');
        const path = `${DB_ROOT}/${safeEmail}/userData/Monthly_Reflection/${year}/${month}`;

        try {
            await withTimeout(db.ref(path).set({ praising, prayer }), TIMEOUT_MS);
            reflectionData = { praising, prayer };
        } catch (err) {
            console.warn('Reflection save failed; continuing with report:', err);
        }
    }

    $('editReflectionBtn')?.addEventListener('click', () => {
        $('praising').value = toPointLines(reflectionData.praising);
        $('prayer').value = toPointLines(reflectionData.prayer);
        $('reflectionEditor').hidden = false;
        $('reflectionSummary').hidden = true;
    });

    /* ---------- Generate ---------- */
    async function onGenerate() {
        if (!session) {
            notify('Please login to generate a report.', 'error');
            return;
        }

        const base = $('baseInput').value.trim();
        const region = $('regionInput').value.trim();
        const month = $('monthSelect').value;
        const year = $('yearSelect').value;

        if (!base || !region) {
            notify('Please enter your base and region.', 'error');
            return;
        }

        const btn = $('generateBtn');
        setLoading(btn, true, 'Preparing…');

        try {
            await saveReflectionIfEdited();
        } catch (err) {
            console.warn('Could not save reflection before generate:', err);
        }

        const query = new URLSearchParams({
            name: session.name,
            email: session.email,
            base,
            region,
            month,
            year
        });

        window.location.href = `${target}?${query.toString()}`;
    }

    /* ---------- Boot ---------- */
    $('backBtn').addEventListener('click', () => {
        if (history.length > 1) history.back();
        else location.href = Session.HOME_URL;
    });
    $('loginBtn').addEventListener('click', () => Session.login());
    $('generateBtn').addEventListener('click', onGenerate);

    fillDateSelects();
    restoreSaved();
    persist('baseInput', BASE_KEY);
    persist('regionInput', REGION_KEY);

    if (kind === 'field') {
        $('monthSelect').addEventListener('change', loadReflection);
        $('yearSelect').addEventListener('change', () => {
            checkKraHint();
            loadReflection();
        });
    }

    window.addEventListener('pageshow', () => setLoading($('generateBtn'), false));

    Session.watch(renderAuth);
})();