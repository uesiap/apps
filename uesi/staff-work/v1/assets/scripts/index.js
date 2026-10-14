// /apps/uesi/staff-work/v1/assets/scripts/index.js
(() => {
    'use strict';

    const { $, Session, Drawer, notify, confirm: askConfirm, setLoading } = window.UI;

    const APP_URL = 'https://uesiap.github.io/apps/uesi/staff-work/v1/';
    const DB_ROOT = 'apps/uesi/staff-work/v1/users';
    const MAX_RANGE_DAYS = 62;
    const SAVE_TIMEOUT_MS = 20000;

    const FORMS = {
        field: {
            formId: 'fieldForm',
            type: 'Field_Report',
            noun: 'field report',
            datePrefix: 'f',
            isField: true
        },
        itinerary: {
            formId: 'itineraryForm',
            type: 'Itinerary_Form',
            noun: 'itinerary',
            datePrefix: 'i',
            isField: false
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

    /* ---------- Helpers ---------- */
    const pad = (n) => String(n).padStart(2, '0');
    const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const weekdayOf = (ymd) =>
        new Date(ymd + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' });

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
            history.replaceState(
                null, '',
                name === 'itinerary' ? '#ItineraryForm' : '#FieldReport'
            );
        }
    }

    /* ---------- Date type toggle + KRA/place UI ---------- */
    function setupForm(key) {
        const cfg = FORMS[key];
        const p = cfg.datePrefix;
        const singleBox = $(`${p}_single_fields`);
        const multiBox = $(`${p}_multi_fields`);
        const singleIn = $(`${p}_date_single`);
        const startIn = $(`${p}_start_multi`);
        const endIn = $(`${p}_end_multi`);

        const refresh = () => {
            const isMulti =
                document.querySelector(`input[name="${p}_dateType"]:checked`)?.value === 'multi';
            singleBox.classList.toggle('hidden', isMulti);
            multiBox.classList.toggle('hidden', !isMulti);
            singleIn.disabled = isMulti;
            startIn.disabled = !isMulti;
            endIn.disabled = !isMulti;
        };

        document.querySelectorAll(`input[name="${p}_dateType"]`).forEach((radio) => {
            radio.addEventListener('change', refresh);
        });

        cfg.refreshDates = refresh;
        refresh();

        if (cfg.isField) {
            const kraSel = $('f_kra');
            const placeField = $('f_place_field');
            const placeInput = $('f_place');

            const refreshKra = () => {
                const isOther = kraSel.value === '0';
                placeField.classList.toggle('hidden', !isOther);
                if (!isOther) placeInput.value = '';
            };
            kraSel.addEventListener('change', refreshKra);
            cfg.refreshKra = refreshKra;
            refreshKra();

            $('f_place').addEventListener('blur', (e) => {
                const v = e.target.value.trim();
                e.target.value = v ? v.charAt(0).toUpperCase() + v.slice(1) : '';
            });
        }
    }

    function setDefaults() {
        $('f_date_single').value = toYMD(new Date());
        $('i_date_single').value = toYMD(new Date());
    }

    function collectDates(key) {
        const p = FORMS[key].datePrefix;
        const isMulti =
            document.querySelector(`input[name="${p}_dateType"]:checked`)?.value === 'multi';

        if (!isMulti) {
            const d = $(`${p}_date_single`).value;
            if (!d) throw new Error('Please select a date.');
            return [d];
        }

        const s = $(`${p}_start_multi`).value;
        const e = $(`${p}_end_multi`).value;
        if (!s || !e) throw new Error('Please select both a start and an end date.');
        if (s > e) throw new Error('The start date cannot be after the end date.');

        const dates = datesBetween(s, e);
        if (dates.length > MAX_RANGE_DAYS) {
            throw new Error(`Please keep the range within ${MAX_RANGE_DAYS} days.`);
        }
        return dates;
    }

    /* ---------- Save ---------- */
    function saveData(cfg, email, dates, payloadBuilder) {
        const safeEmail = email.replace(/\./g, '_');
        const updates = {};

        dates.forEach((date) => {
            const [year, month] = date.split('-');
            const path = `${DB_ROOT}/${safeEmail}/userData/${cfg.type}/${year}/${month}/${date}`;
            updates[path] = payloadBuilder(date);
        });

        return withTimeout(db.ref().update(updates), SAVE_TIMEOUT_MS);
    }

    function bindForm(key) {
        const cfg = FORMS[key];
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
            try { dates = collectDates(key); }
            catch (err) { notify(err.message, 'error'); return; }

            let payloadBuilder;
            let successSpan = dates.length > 1 ? ` for ${dates.length} days` : '';

            if (cfg.isField) {
                const kra = Number($('f_kra').value);
                const place = $('f_place').value.trim();
                const activity = $('f_activity').value.trim();

                if (!activity) {
                    notify('Please describe what happened in the activity field.', 'error');
                    return;
                }
                if (kra === 0 && !place) {
                    notify('Please enter the place for an "Other than KRA" entry.', 'error');
                    return;
                }

                payloadBuilder = (date) => ({
                    day: weekdayOf(date),
                    kra,
                    place: kra === 0 ? place : '',
                    activity
                });
            } else {
                const place = $('i_place').value.trim();
                const activity = $('i_activity').value.trim();

                if (!place) {
                    notify('Please enter the place & purpose.', 'error');
                    return;
                }
                if (!activity) {
                    notify('Please describe the activities with details.', 'error');
                    return;
                }

                payloadBuilder = (date) => ({
                    day: weekdayOf(date),
                    place,
                    activity
                });
            }

            setLoading(btn, true);
            try {
                await saveData(cfg, session.email, dates, payloadBuilder);
                form.reset();
                if (key === 'field') {
                    setDefaults();
                    cfg.refreshKra();
                } else {
                    setDefaults();
                }
                cfg.refreshDates();
                notify(`Your ${cfg.noun} has been saved${successSpan}.`, 'success', 'Submitted');
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
            title: 'UESI Staff Work v1',
            text: 'Submit, view and generate KRA-based reports with the UESI Staff Work app.',
            url: APP_URL
        };
        if (navigator.share) {
            try { await navigator.share(data); } catch (_) {}
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

    /* ---------- Boot ---------- */
    setupForm('field');
    setupForm('itinerary');
    setDefaults();
    bindForm('field');
    bindForm('itinerary');

    showTab(location.hash === '#ItineraryForm' ? 'itinerary' : 'field', false);
    Session.watch(renderAuth);

    /* ---------- Service worker ---------- */
    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        navigator.serviceWorker
            .register('/apps/uesi/staff-work/v1/service-worker.js')
            .catch((err) => console.error('SW registration failed:', err));
    }

    registerServiceWorker();
})();