
(() => {
    'use strict';

    const { $, Session, notify, setLoading } = window.UI;

    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const HOME = '/apps/uesi/staff-work/';
    const DB_ROOT = 'apps/uesi/staff-work/users';
    const TIMEOUT_MS = 20000;

    class LoginError extends Error {}

    if (!firebase.apps.length) {
        firebase.initializeApp({
            apiKey: '0AzyPiDT3wSi6WAuNX7YzbyJcvUgV0nyoxMwahn0',
            authDomain: 'uesi-ap-default-rtdb.firebaseio.com',
            databaseURL: 'https://uesi-ap-default-rtdb.firebaseio.com',
            projectId: 'uesi-ap'
        });
    }
    const db = firebase.database();

    function withTimeout(promise, ms) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    /* ---------- Already logged in: go straight to the app ---------- */
    if (Session.read()) {
        location.replace(HOME);
        return;
    }
    document.body.classList.remove('checking');

    /* ---------- Password show / hide ---------- */
    $('pwToggle').addEventListener('click', () => {
        const input = $('password');
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';

        const btn = $('pwToggle');
        btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
        btn.querySelector('i').className = showing ? 'fas fa-eye' : 'fas fa-eye-slash';
    });

    /* ---------- Submit ---------- */
    async function onSubmit(e) {
        e.preventDefault();

        const email = $('email').value.trim();
        const password = $('password').value;
        const btn = $('loginSubmit');

        if (!email || !password) {
            notify('Please enter your email and password.', 'error');
            return;
        }
        if (!EMAIL_RE.test(email)) {
            notify('Please enter a valid email address.', 'error');
            return;
        }

        setLoading(btn, true, 'Logging in...');

        let user;
        try {
            const safeEmail = email.replace(/\./g, '_');
            const snap = await withTimeout(
                db.ref(`${DB_ROOT}/${safeEmail}`).once('value'),
                TIMEOUT_MS
            );

            if (!snap.exists()) throw new LoginError('No account was found for this email.');

            user = snap.val() || {};
            if (user.password !== password) throw new LoginError('The password is incorrect.');
        } catch (err) {
            setLoading(btn, false);

            if (err instanceof LoginError) {
                notify(err.message, 'error', 'Login failed');
            } else {
                console.error('Login failed:', err);
                notify(
                    err.message === 'timeout'
                        ? 'No response from the server. Check your connection and try again.'
                        : 'Could not log in. Please try again.',
                    'error'
                );
            }
            return;
        }

        try {
            // Fall back to the part of the email before @ if no name is stored
            localStorage.setItem('bbsName', user.name || email.split('@')[0]);
            localStorage.setItem('bbsRole', email);
        } catch (err) {
            setLoading(btn, false);
            notify('Your browser blocked saving the login. Please allow site storage and try again.', 'error');
            return;
        }

        setLoading(btn, true, 'Redirecting...');
        await notify('You are now logged in.', 'success', 'Welcome');
        location.replace(HOME);
    }

    /* ---------- Boot ---------- */
    $('loginForm').addEventListener('submit', onSubmit);

    // If the browser restores this page from history, clear the loading state
    window.addEventListener('pageshow', () => setLoading($('loginSubmit'), false));

    $('email').focus();
})();