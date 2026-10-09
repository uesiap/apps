
(() => {
    'use strict';

    const { $, Session, Drawer, notify, confirm: askConfirm, setLoading } = window.UI;

    const APP_URL = 'https://uesiap.github.io/apps/uesi/staff-work/';
    const SW_PATH = '/apps/uesi/staff-work/service-worker.js';
    const DB_ROOT = 'apps/uesi/staff-work/users';
    const MAX_RANGE_DAYS = 62;
    const SAVE_TIMEOUT_MS = 20000;
    const PUSH_ENDPOINT = 'https://uesi.ruvs.in/apps/staff/work/api/subscribe';
    const VAPID_PUBLIC_KEY = 'BPHR6KT0pldq-HrY0PvrnhodCx0Qpb8OHCBHdM9RbfpyhywI1Tl3QW67_o42zCnl1nkpy30kjvJmzZf8AfzsGg0';

    // Each form is described once. Adding a form means adding one entry here.
    const FORMS = {
        1: { formId: 'fieldReportForm', zoneId: 'zone1', purposeId: 'purpose1', type: 'Field_Report', noun: 'field report' },
        2: { formId: 'itineraryForm', zoneId: 'zone2', purposeId: 'purpose2', type: 'Itinerary_Form', noun: 'itinerary' }
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

    /* ---------- Helpers ---------- */
    const pad = (n) => String(n).padStart(2, '0');
    const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const weekdayOf = (ymd) => new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });

    function datesBetween(startStr, endStr) {
        const out = [];
        const cur = new Date(startStr + 'T12:00:00');
        const end = new Date(endStr + 'T12:00:00');
        while (cur <= end) {
            out.push(toYMD(cur));
            cur.setDate(cur.getDate() + 1);
        }
        return out;
    }

    function splitPurpose(raw) {
        return raw
            .split('\n')
            .map((line) => line.trim().replace(/^[*\-•]\s*/, ''))
            .filter(Boolean);
    }

    function withTimeout(promise, ms) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    /* ---------- Auth-dependent UI ---------- */
    function renderAuth(session) {
        const body = document.body;
        body.classList.remove('auth-pending', 'is-authed', 'is-guest');
        body.classList.add(session ? 'is-authed' : 'is-guest');

        $('drawerName').textContent = session ? session.name : 'Not logged in';
        $('drawerEmail').textContent = session ? session.email : '';

        if (session) {
            $('greetName').textContent = session.name;
            enablePush();
        } else {
            Drawer.close();
        }
    }

    /* ---------- Tabs ---------- */
    function showTab(name, updateHash = true) {
        document.querySelectorAll('.tab-panel').forEach((panel) => {
            panel.classList.toggle('hidden', panel.dataset.tab !== name);
        });
        document.querySelectorAll('.bnav-item').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.tab === name);
        });
        if (updateHash) {
            history.replaceState(null, '', name === 'itinerary' ? '#ItineraryForm' : '#FieldReport');
        }
    }

    /* ---------- Date type toggle ---------- */
    function setupForm(n) {
        const cfg = FORMS[n];
        const singleBox = $(`date${n}_single_fields`);
        const multiBox = $(`date${n}_multi_fields`);
        const singleIn = $(`date${n}_start_single`);
        const startIn = $(`date${n}_start_multi`);
        const endIn = $(`date${n}_end_multi`);

        const refresh = () => {
            const isMulti = document.querySelector(`input[name="dateType${n}"]:checked`)?.value === 'multi';
            singleBox.classList.toggle('hidden', isMulti);
            multiBox.classList.toggle('hidden', !isMulti);
            // Disabled inputs are skipped when reading the form
            singleIn.disabled = isMulti;
            startIn.disabled = !isMulti;
            endIn.disabled = !isMulti;
        };

        document.querySelectorAll(`input[name="dateType${n}"]`).forEach((radio) => {
            radio.addEventListener('change', refresh);
        });

        cfg.refresh = refresh;
        refresh();

        $(cfg.zoneId).addEventListener('blur', (e) => {
            const v = e.target.value.trim();
            e.target.value = v ? v.charAt(0).toUpperCase() + v.slice(1) : '';
        });
    }

    function setDefaultDate() {
        $('date1_start_single').value = toYMD(new Date());
    }

    function collectDates(n) {
        const isMulti = document.querySelector(`input[name="dateType${n}"]:checked`)?.value === 'multi';

        if (!isMulti) {
            const d = $(`date${n}_start_single`).value;
            if (!d) throw new Error('Please select a date.');
            return [d];
        }

        const s = $(`date${n}_start_multi`).value;
        const e = $(`date${n}_end_multi`).value;
        if (!s || !e) throw new Error('Please select both a start and an end date.');
        if (s > e) throw new Error('The start date cannot be after the end date.');

        const dates = datesBetween(s, e);
        if (dates.length > MAX_RANGE_DAYS) {
            throw new Error(`Please keep the range within ${MAX_RANGE_DAYS} days.`);
        }
        return dates;
    }

    /* ---------- Save ---------- */
    function saveFormData(cfg, email, dates, purpose, zone) {
        const safeEmail = email.replace(/\./g, '_');
        const updates = {};

        dates.forEach((date) => {
            const [year, month] = date.split('-');
            const path = `${DB_ROOT}/${safeEmail}/userData/${cfg.type}/${year}/${month}/${date}`;
            updates[path] = { day: weekdayOf(date), purpose, zone };
        });

        // One atomic multi-path write for all dates
        return withTimeout(db.ref().update(updates), SAVE_TIMEOUT_MS);
    }

    function bindForm(n) {
        const cfg = FORMS[n];
        const form = $(cfg.formId);
        const btn = form.querySelector('.submit-btn');

        form.addEventListener('submit', async (e) => {
            e.preventDefault();

            const session = Session.read();
            if (!session) {
                notify('Please login to submit your data.', 'error');
                return;
            }

            let dates;
            try {
                dates = collectDates(n);
            } catch (err) {
                notify(err.message, 'error');
                return;
            }

            const zone = $(cfg.zoneId).value.trim();
            const purpose = splitPurpose($(cfg.purposeId).value);

            if (!zone) {
                notify('Please enter the zone / division.', 'error');
                return;
            }
            if (purpose.length === 0) {
                notify('Please write the purpose. Each new line is one point.', 'error');
                return;
            }

            setLoading(btn, true);
            try {
                await saveFormData(cfg, session.email, dates, purpose, zone);
                form.reset();
                if (n === 1) setDefaultDate();
                cfg.refresh();

                const span = dates.length > 1 ? ` for ${dates.length} days` : '';
                notify(`Your ${cfg.noun} has been saved${span}.`, 'success', 'Submitted');
            } catch (err) {
                console.error('Save failed:', err);
                notify(
                    err.message === 'timeout'
                        ? 'No response from the server. Check your connection and try again.'
                        : 'Could not save your data. Please try again.',
                    'error'
                );
            } finally {
                setLoading(btn, false);
            }
        });
    }

    /* ---------- Share ---------- */
    async function shareApp() {
        const data = {
            title: 'UESI Staff Work',
            text: 'Submit, edit and generate reports with the UESI Staff Work app.',
            url: APP_URL
        };

        if (navigator.share) {
            try {
                await navigator.share(data);
            } catch (_) { /* user cancelled */ }
            return;
        }

        try {
            await navigator.clipboard.writeText(APP_URL);
            notify('App link copied to clipboard.', 'success', 'Link copied');
        } catch {
            notify('Sharing is not supported on this device.', 'error');
        }
    }

    /* ---------- Logout ---------- */
    async function logout() {
        const ok = await askConfirm({
            title: 'Log out?',
            text: 'You will need to login again to submit data.',
            okText: 'Log out'
        });
        if (!ok) return;

        Session.clear();
        renderAuth(null);
        notify('You have been logged out.', 'info', 'Logged out');
    }

    /* ---------- Install prompt (phones only) ---------- */
    let deferredPrompt = null;

    const isStandalone = () =>
        window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

    const isPhone = () =>
        window.matchMedia('(max-width: 768px)').matches && window.matchMedia('(pointer: coarse)').matches;

    function showInstallIfEligible() {
        if (!deferredPrompt || isStandalone() || !isPhone()) return;
        if (localStorage.getItem('installDismissed')) return;
        $('installCard').classList.remove('hidden');
    }

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        showInstallIfEligible();
    });

    window.addEventListener('appinstalled', () => {
        $('installCard').classList.add('hidden');
    });

    $('installBtn').addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        try {
            await deferredPrompt.userChoice;
        } catch (_) { /* ignore */ }
        deferredPrompt = null;
        $('installCard').classList.add('hidden');
    });

    $('installDismiss').addEventListener('click', () => {
        localStorage.setItem('installDismissed', '1');
        $('installCard').classList.add('hidden');
    });

    /* ---------- Push notifications (once per page load, after login) ---------- */
    let pushAttempted = false;

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = atob(base64);
        return Uint8Array.from(raw, (c) => c.charCodeAt(0));
    }

    
    async function enablePush() {
        if (pushAttempted) return;
        pushAttempted = true;

        if (
            !('serviceWorker' in navigator) ||
            !('PushManager' in window) ||
            !('Notification' in window)
        ) return;

        if (Notification.permission === 'denied') return;

        const session = Session.read();
        if (!session?.email) return;

        try {
            const registration = await navigator.serviceWorker.ready;

            if (Notification.permission !== 'granted') {
                const result = await Notification.requestPermission();
                if (result !== 'granted') return;
            }

            let subscription = await registration.pushManager.getSubscription();

            if (!subscription) {
                subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
                });
            }

            const response = await fetch(PUSH_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: session.email,
                    name: session.name || '',
                    subscription: subscription.toJSON()
                })
            });

            if (!response.ok) {
                throw new Error(`Subscription API returned HTTP ${response.status}`);
            }

            console.log('Push subscription registered successfully.');
        } catch (err) {
            console.warn('Push setup failed:', err);
        }
    }


    /* ---------- Drawer actions ---------- */
    $('drawer').addEventListener('click', (e) => {
        const nav = e.target.closest('[data-nav]');
        if (nav) {
            Drawer.close();
            Session.go(nav.dataset.nav);
            return;
        }

        const action = e.target.closest('[data-action]')?.dataset.action;
        if (action === 'share') shareApp();
        if (action === 'login') Session.login();
        if (action === 'logout') logout();
    });

    $('loginBtn').addEventListener('click', () => Session.login());

    document.querySelectorAll('.bnav-item').forEach((btn) => {
        btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });

    /* ---------- Service worker ---------- */
    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        navigator.serviceWorker
            .register(SW_PATH)
            .catch((err) => console.error('Service worker registration failed:', err));
    }

    /* ---------- Boot ---------- */
    setupForm(1);
    setupForm(2);
    setDefaultDate();
    bindForm(1);
    bindForm(2);

    showTab(location.hash === '#ItineraryForm' ? 'itinerary' : 'field', false);
    Session.watch(renderAuth);
    registerServiceWorker();
})();