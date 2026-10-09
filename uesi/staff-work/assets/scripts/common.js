/* =========================================================
   common.js - shared by every staff-work page.
   Owns: touch feedback, drawer, dialogs, loading buttons, session.
   Exposed as window.UI.
   ========================================================= */
(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const LOGIN_URL = 'https://uesiap.github.io/apps/uesi/staff-work/login';

    const ready = (fn) =>
        document.readyState === 'loading'
            ? document.addEventListener('DOMContentLoaded', fn)
            : fn();

    /* ---------- Touch feedback: ripple + light haptic on press ---------- */
    function initTouchFeedback() {
        const coarse = window.matchMedia('(pointer: coarse)').matches;

        document.addEventListener('pointerdown', (e) => {
            const host = e.target.closest('.ripple');
            if (!host) return;

            const rect = host.getBoundingClientRect();
            const size = Math.max(rect.width, rect.height) * 2.2;
            const wave = document.createElement('span');
            wave.className = 'ripple-wave';
            wave.style.width = wave.style.height = `${size}px`;
            wave.style.left = `${e.clientX - rect.left - size / 2}px`;
            wave.style.top = `${e.clientY - rect.top - size / 2}px`;
            host.appendChild(wave);
            wave.addEventListener('animationend', () => wave.remove());

            if (coarse && navigator.vibrate) navigator.vibrate(6);
        }, { passive: true });
    }

    /* ---------- Drawer ---------- */
    const Drawer = (() => {
        function open() {
            $('drawer')?.classList.add('open');
            $('drawer')?.setAttribute('aria-hidden', 'false');
            $('scrim')?.classList.add('show');
        }

        function close() {
            $('drawer')?.classList.remove('open');
            $('drawer')?.setAttribute('aria-hidden', 'true');
            $('scrim')?.classList.remove('show');
        }

        function init() {
            document.querySelectorAll('[data-drawer-open]').forEach((el) =>
                el.addEventListener('click', open));
            document.querySelectorAll('[data-drawer-close]').forEach((el) =>
                el.addEventListener('click', close));
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') close();
            });
        }

        return { open, close, init };
    })();

    /* ---------- Dialog: one reusable component for alerts and confirms ---------- */
    const Dialog = (() => {
        const ICONS = {
            success: 'fa-circle-check',
            error: 'fa-circle-xmark',
            info: 'fa-circle-info',
            warning: 'fa-triangle-exclamation'
        };
        const TITLES = {
            success: 'Done',
            error: 'Something went wrong',
            info: 'Notice',
            warning: 'Please confirm'
        };

        let refs = null;
        let resolver = null;

        function build() {
            const backdrop = document.createElement('div');
            backdrop.className = 'dlg-backdrop';

            const box = document.createElement('div');
            box.className = 'dlg';
            box.setAttribute('role', 'alertdialog');
            box.setAttribute('aria-modal', 'true');
            box.innerHTML = `
                <div class="dlg-icon"><i class="fas"></i></div>
                <h2 class="dlg-title"></h2>
                <p class="dlg-text"></p>
                <div class="dlg-actions">
                    <button type="button" class="btn btn-outline ripple dlg-cancel">Cancel</button>
                    <button type="button" class="btn btn-primary ripple dlg-ok">OK</button>
                </div>`;

            document.body.append(backdrop, box);

            refs = {
                backdrop,
                box,
                icon: box.querySelector('.dlg-icon'),
                iconGlyph: box.querySelector('.dlg-icon i'),
                title: box.querySelector('.dlg-title'),
                text: box.querySelector('.dlg-text'),
                ok: box.querySelector('.dlg-ok'),
                cancel: box.querySelector('.dlg-cancel')
            };

            refs.ok.addEventListener('click', () => close(true));
            refs.cancel.addEventListener('click', () => close(false));
            backdrop.addEventListener('click', () => close(false));
        }

        function open({ title, text, tone = 'info', okText = 'OK', cancelText = null }) {
            if (!refs) build();
            if (resolver) close(false);

            refs.icon.className = `dlg-icon ${tone}`;
            refs.iconGlyph.className = `fas ${ICONS[tone] || ICONS.info}`;
            refs.title.textContent = title || TITLES[tone] || TITLES.info;
            refs.text.textContent = text;
            refs.ok.textContent = okText;
            refs.cancel.textContent = cancelText || 'Cancel';
            refs.cancel.hidden = !cancelText;

            refs.backdrop.classList.add('show');
            refs.box.classList.add('show');
            refs.ok.focus();

            return new Promise((resolve) => { resolver = resolve; });
        }

        function close(result) {
            if (!refs) return;
            refs.backdrop.classList.remove('show');
            refs.box.classList.remove('show');
            const done = resolver;
            resolver = null;
            if (done) done(result);
        }

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && resolver) close(false);
        });

        return { open, close };
    })();

    const notify = (text, tone = 'info', title) => Dialog.open({ title, text, tone });

    const confirm = (opts) =>
        Dialog.open({ tone: 'warning', okText: 'Confirm', cancelText: 'Cancel', ...opts });

    /* ---------- Loading state for buttons ---------- */
    function setLoading(btn, on, label = 'Submitting...') {
        if (on) {
            if (!btn.dataset.idle) btn.dataset.idle = btn.innerHTML;
            btn.disabled = true;
            btn.classList.add('is-loading');
            btn.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${label}</span>`;
        } else {
            btn.disabled = false;
            btn.classList.remove('is-loading');
            if (btn.dataset.idle) {
                btn.innerHTML = btn.dataset.idle;
                delete btn.dataset.idle;
            }
        }
    }

    /* ---------- Session: single source of truth for login state ---------- */
    const Session = {
        LOGIN_URL,

        read() {
            const email = (localStorage.getItem('bbsRole') || '').trim();
            const name = (localStorage.getItem('bbsName') || '').trim();
            return name && EMAIL_RE.test(email) ? { name, email } : null;
        },

        clear() {
            localStorage.removeItem('bbsRole');
            localStorage.removeItem('bbsName');
        },

        login() {
            window.location.href = LOGIN_URL;
        },

        query(session) {
            const params = new URLSearchParams();
            params.append('name', encodeURIComponent(session.name));
            params.append('email', encodeURIComponent(session.email));
            return params.toString();
        },

        go(path) {
            const session = Session.read();
            if (!session) {
                notify('Please login first.', 'error');
                return;
            }
            window.location.href = path;
        },

        /* Calls cb(session) now, and again only when login state can change:
           another tab edits storage, the page is restored, or the tab regains focus.
           No polling. */
        watch(cb) {
            const run = () => cb(Session.read());
            window.addEventListener('storage', (e) => {
                if (e.key === null || e.key === 'bbsRole' || e.key === 'bbsName') run();
            });
            window.addEventListener('pageshow', run);
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden) run();
            });
            run();
        }
    };

    window.UI = { $, Session, Drawer, Dialog, notify, confirm, setLoading };

    ready(() => {
        initTouchFeedback();
        Drawer.init();
    });
})();