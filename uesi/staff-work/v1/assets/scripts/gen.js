// /apps/uesi/staff-work/v1/assets/scripts/gen.js
// Generate page for the field report and the itinerary.
// <body data-kind="field|itinerary"> chooses the target page and the field-only extras.
(() => {
    'use strict';

    const { $, Session, notify, setLoading } = window.UI;

    const KIND = document.body.dataset.kind === 'itinerary' ? 'itinerary' : 'field';
    const IS_FIELD = KIND === 'field';

    const TARGETS = {
        field: '/apps/uesi/staff-work/v1/gen/final/field-report',
        itinerary: '/apps/uesi/staff-work/v1/gen/final/itinerary'
    };

    // Saved on this device and shared by both reports
    const KEYS = {
        base: 'reportBase_v1',
        state: 'reportState_v1',
        region: 'reportRegion_v1',
        copyTo: 'itinCopyTo_v1',
        role: 'itinRole_v1',
        signature: 'itinSignature_v1'
    };

    const DEFAULT_REGION = 'Hyderabad';
    const DEFAULT_COPY_TO = [
        'UESI TG Office',
        'UESI TG State Secretary',
        'Hyderabad Regional Co-ordinator',
        'Medchal - Malkajgiri District Co-ordinator'
    ];

    const SIG_MAX_PX = 360;
    const SIG_MAX_CHARS = 350000;
    const SIG_MAX_FILE = 5 * 1024 * 1024;
    const YEAR_SPAN = 2;
    const DB_ROOT = 'apps/uesi/staff-work/v1/users';
    const TIMEOUT_MS = 15000;
    const MONTHS = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const pad = (n) => String(n).padStart(2, '0');

    // Small store wrapper: storage can be blocked in some browsers
    const store = {
        get(key, fallback = '') {
            try {
                const v = localStorage.getItem(key);
                return v === null ? fallback : v;
            } catch (_) {
                return fallback;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, value);
                return true;
            } catch (_) {
                return false;
            }
        },
        remove(key) {
            try { localStorage.removeItem(key); } catch (_) { /* ignore */ }
        }
    };

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
    let busy = false;
    let reflectionData = { praising: [], prayer: [] };

    const genBtn = () => $('generateBtn') || document.querySelector('#reportForm .submit-btn');
    const valOf = (id) => ($(id) ? $(id).value.trim() : '');
    const setVal = (id, v) => { if ($(id)) $(id).value = v; };

    function withTimeout(promise, ms) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

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

    /* ---------- Auth ---------- */
    function renderAuth(s) {
        const body = document.body;
        body.classList.remove('auth-pending', 'is-authed', 'is-guest');
        body.classList.add(s ? 'is-authed' : 'is-guest');

        session = s;
        setVal('staffName', s ? s.name : '');
        setVal('staffEmail', s ? s.email : '');

        if (s && IS_FIELD) {
            checkKraHint();
            loadReflection();
        }
    }

    /* ---------- Month and year ---------- */
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

    /* ---------- Saved details (same for both reports) ---------- */
    function readCopyTo() {
        const saved = store.get(KEYS.copyTo, null);
        return saved === null ? DEFAULT_COPY_TO.join('\n') : saved;
    }

    function restoreSaved() {
        setVal('baseInput', store.get(KEYS.base));
        setVal('stateInput', store.get(KEYS.state));
        setVal('regionInput', store.get(KEYS.region, DEFAULT_REGION));
        setVal('roleInput', store.get(KEYS.role));
        setVal('copyToInput', readCopyTo());
        showSignature(store.get(KEYS.signature));
    }

    function bindSaving() {
        const save = (id, key) => $(id)?.addEventListener('input', (e) => store.set(key, e.target.value));
        save('baseInput', KEYS.base);
        save('stateInput', KEYS.state);
        save('regionInput', KEYS.region);
        save('roleInput', KEYS.role);
        save('copyToInput', KEYS.copyTo);

        $('copyToReset')?.addEventListener('click', () => {
            store.remove(KEYS.copyTo);
            setVal('copyToInput', DEFAULT_COPY_TO.join('\n'));
            notify('The copy to list is back to the default.', 'success', 'Restored');
        });

        $('sigInput')?.addEventListener('change', onSignatureChosen);
        $('sigRemove')?.addEventListener('click', () => {
            store.remove(KEYS.signature);
            showSignature('');
        });
    }

    /* ---------- Signature ---------- */
    function showSignature(dataUrl) {
        const has = Boolean(dataUrl);
        if ($('sigPreview')) {
            $('sigPreview').src = has ? dataUrl : '';
            $('sigPreview').hidden = !has;
        }
        if ($('sigEmpty')) $('sigEmpty').hidden = has;
        if ($('sigRemove')) $('sigRemove').hidden = !has;
    }

    // Scales the picture down and places it on white, so it prints cleanly and fits storage
    function toSignature(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                const scale = Math.min(1, SIG_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                let data = canvas.toDataURL('image/png');
                if (data.length > SIG_MAX_CHARS) data = canvas.toDataURL('image/jpeg', 0.85);
                resolve(data);
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Unreadable image'));
            };
            img.src = url;
        });
    }

    async function onSignatureChosen(e) {
        const file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            notify('Please choose an image file (PNG or JPG).', 'error');
            return;
        }
        if (file.size > SIG_MAX_FILE) {
            notify('That image is larger than 5 MB. Please choose a smaller one.', 'error');
            return;
        }

        try {
            const dataUrl = await toSignature(file);
            if (dataUrl.length > SIG_MAX_CHARS) {
                notify('That picture is too large to save. Try a smaller photo of your signature.', 'error');
                return;
            }
            if (!store.set(KEYS.signature, dataUrl)) {
                notify('Your browser blocked saving the signature. Please allow site storage.', 'error');
                return;
            }
            showSignature(dataUrl);
            notify('Your signature has been saved on this device.', 'success', 'Saved');
        } catch (err) {
            console.error('Signature failed:', err);
            notify('Could not read that image. Please try another one.', 'error');
        }
    }

    /* ---------- KRA hint (field report only) ---------- */
    async function checkKraHint() {
        if (!IS_FIELD || !session || !$('kraHint')) return;
        const year = $('yearSelect').value;
        const month = $('monthSelect').value;
        if (!year || !month) return;

        const safeEmail = session.email.replace(/\./g, '_');
        const path = `${DB_ROOT}/${safeEmail}/userData/KRA_Objectives/${year}/${pad(month)}`;

        try {
            const snap = await withTimeout(db.ref(path).once('value'), TIMEOUT_MS);
            const hasAny = normalizeList(snap.val()).length > 0;
            $('kraHint').hidden = hasAny;
            if ($('kraHintYear')) $('kraHintYear').textContent = `${MONTHS[Number(month) - 1]} ${year}`;
        } catch {
            $('kraHint').hidden = true;
        }
    }

    /* ---------- Praise and prayer (field report only) ---------- */
    function parsePoints(raw) {
        return String(raw || '')
            .split('\n')
            .map((line) => line.trim().replace(/^\d+[.)]\s*/, '').replace(/^[*\-•]\s*/, ''))
            .filter(Boolean);
    }

    const toPointLines = (arr) => arr.map((p, i) => `${i + 1}. ${p}`).join('\n');

    const listItems = (items) => {
        if (!items.length) return [Object.assign(document.createElement('li'), { textContent: '—' })];
        return items.map((t) => Object.assign(document.createElement('li'), { textContent: t }));
    };

    async function loadReflection() {
        if (!IS_FIELD || !session || !$('reflectionCard')) return;

        const year = $('yearSelect').value;
        const month = pad($('monthSelect').value);
        if (!year || !month) return;

        const safeEmail = session.email.replace(/\./g, '_');
        const path = `${DB_ROOT}/${safeEmail}/userData/Monthly_Reflection/${year}/${month}`;

        try {
            const snap = await withTimeout(db.ref(path).once('value'), TIMEOUT_MS);
            const data = snap.val() || {};
            reflectionData = {
                praising: normalizeList(data.praising),
                prayer: normalizeList(data.prayer)
            };
        } catch (err) {
            console.error('Reflection load failed:', err);
            reflectionData = { praising: [], prayer: [] };
        }
        renderReflection();
    }

    function renderReflection() {
        if (!IS_FIELD || !$('reflectionCard')) return;

        const hasAny = reflectionData.praising.length > 0 || reflectionData.prayer.length > 0;

        $('reflectionCard').hidden = false;
        $('reflectionEditor').hidden = hasAny;
        $('reflectionSummary').hidden = !hasAny;

        if (hasAny) {
            $('reflectionPraisingList').replaceChildren(...listItems(reflectionData.praising));
            $('reflectionPrayerList').replaceChildren(...listItems(reflectionData.prayer));
            $('reflectionSub').textContent =
                `Saved for ${MONTHS[Number($('monthSelect').value) - 1]} ${$('yearSelect').value}.`;
        } else {
            $('reflectionSub').textContent =
                'No reflection saved for this month yet. Fill it in now; it will be saved with the report.';
        }
    }

    async function saveReflectionIfEdited() {
        const editor = $('reflectionEditor');
        if (!IS_FIELD || !session || !editor || editor.hidden) return;

        const praising = parsePoints($('praising').value);
        const prayer = parsePoints($('prayer').value);
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

    /* ---------- Generate ---------- */
    async function onGenerate(e) {
        e?.preventDefault?.();
        if (busy) return;

        if (!session) {
            notify('Please login to generate a report.', 'error');
            return;
        }

        const base = valOf('baseInput');
        const state = valOf('stateInput');
        const region = valOf('regionInput');
        const month = $('monthSelect').value;
        const year = $('yearSelect').value;

        if (!base || !state || !region) {
            notify('Please enter your base, state and region.', 'error');
            return;
        }

        busy = true;
        const btn = genBtn();
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
            state,
            region,
            month,
            year
        });

        window.location.href = `${TARGETS[KIND]}?${query.toString()}`;
    }

    /* ---------- Boot ---------- */
    $('backBtn')?.addEventListener('click', () => {
        if (history.length > 1) history.back();
        else location.href = Session.HOME_URL;
    });
    $('loginBtn')?.addEventListener('click', () => Session.login());
    $('generateBtn')?.addEventListener('click', onGenerate);
    $('reportForm')?.addEventListener('submit', onGenerate);

    $('editReflectionBtn')?.addEventListener('click', () => {
        setVal('praising', toPointLines(reflectionData.praising));
        setVal('prayer', toPointLines(reflectionData.prayer));
        $('reflectionEditor').hidden = false;
        $('reflectionSummary').hidden = true;
    });

    fillDateSelects();
    restoreSaved();
    bindSaving();

    if (IS_FIELD) {
        $('monthSelect').addEventListener('change', () => { checkKraHint(); loadReflection(); });
        $('yearSelect').addEventListener('change', () => { checkKraHint(); loadReflection(); });
    }

    // Clears the loading state if the browser restores this page from history
    window.addEventListener('pageshow', () => {
        busy = false;
        setLoading(genBtn(), false);
    });

    Session.watch(renderAuth);
})();