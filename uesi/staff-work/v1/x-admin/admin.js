// /apps/uesi/staff-work/v1/x-admin/admin.js

(() => {
    'use strict';

    const $ = (id) => document.getElementById(id);
    const DB_ROOT = 'apps/uesi/staff-work/v1/users';
    const ADMIN_PATH = 'apps/uesi/staff-work/v1/adminGate';
    const SESSION_KEY = 'uesi_admin_session_v1';
    const TIMEOUT_MS = 20000;
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
    const safeKey = (email) => email.replace(/\./g, '_');

    function withTimeout(promise, ms) {
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('timeout')), ms);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    /* SHA-256 → hex. Used only to hide the passphrase in the DB,
       not as real security (client-side gate). */
    async function sha256(text) {
        const buf = new TextEncoder().encode(text);
        const hash = await crypto.subtle.digest('SHA-256', buf);
        return Array.from(new Uint8Array(hash))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
    }

    function toast(text, kind = 'info') {
        const t = document.createElement('div');
        t.className = `toast toast-${kind}`;
        t.textContent = text;
        document.body.append(t);
        requestAnimationFrame(() => t.classList.add('show'));
        setTimeout(() => {
            t.classList.remove('show');
            setTimeout(() => t.remove(), 300);
        }, 2400);
    }

    function confirmBox(title, text, okLabel = 'Confirm') {
        return new Promise((resolve) => {
            const scrim = document.createElement('div');
            scrim.className = 'editor-scrim';
            const box = document.createElement('div');
            box.className = 'editor';
            box.style.width = 'min(400px, calc(100vw - 32px))';
            box.innerHTML = `
                <div class="editor-head"><h2>${title}</h2></div>
                <div class="editor-body"><p style="color:#b3bac7;line-height:1.5;font-size:.9rem;margin:6px 0 4px;">
                    ${text}
                </p></div>
                <div class="editor-foot">
                    <button class="btn btn-outline" data-x="cancel">Cancel</button>
                    <button class="btn btn-danger" data-x="ok">${okLabel}</button>
                </div>`;
            document.body.append(scrim, box);
            const done = (v) => {
                scrim.remove();
                box.remove();
                resolve(v);
            };
            scrim.addEventListener('click', () => done(false));
            box.querySelector('[data-x="cancel"]').addEventListener('click', () => done(false));
            box.querySelector('[data-x="ok"]').addEventListener('click', () => done(true));
        });
    }

    /* ---------- Gate ---------- */
    const gateState = { mode: null }; // 'setup' | 'unlock'

    async function checkGateMode() {
        try {
            const snap = await withTimeout(db.ref(`${ADMIN_PATH}/passHash`).once('value'), TIMEOUT_MS);
            const hash = snap.val();
            gateState.mode = hash ? 'unlock' : 'setup';
        } catch (err) {
            console.error('Gate read failed:', err);
            // Fall back to unlock; if the DB rules block, error surfaces later
            gateState.mode = 'unlock';
        }
        applyGateMode();
    }

    function applyGateMode() {
        const isSetup = gateState.mode === 'setup';
        $('gateTitle').textContent = isSetup ? 'Set admin passphrase' : 'Admin access';
        $('gateSub').textContent = isSetup
            ? 'Choose a passphrase to protect this page. It will be required from now on.'
            : 'Enter the admin passphrase to continue.';
        $('gateHint').textContent = isSetup
            ? 'Only you should know this. It is stored as a hash in the database.'
            : 'Forgot it? Clear apps/uesi/staff-work/v1/adminGate/passHash in the Firebase console to reset.';
        $('gateBtnLabel').textContent = isSetup ? 'Set passphrase' : 'Unlock';
        $('confirmField').classList.toggle('hidden', !isSetup);
    }

    async function onGateSubmit(e) {
        e.preventDefault();
        const pass = $('passInput').value;
        const confirm = $('passConfirm').value;

        if (!pass) return toast('Enter a passphrase.', 'error');

        if (gateState.mode === 'setup') {
            if (pass.length < 6) return toast('Use at least 6 characters.', 'error');
            if (pass !== confirm) return toast('Passphrases do not match.', 'error');

            const hash = await sha256(pass);
            try {
                await withTimeout(db.ref(`${ADMIN_PATH}/passHash`).set(hash), TIMEOUT_MS);
                sessionStorage.setItem(SESSION_KEY, hash);
                unlockPanel();
            } catch (err) {
                console.error('Gate setup failed:', err);
                toast('Could not save passphrase. Check DB rules.', 'error');
            }
            return;
        }

        // Unlock
        try {
            const snap = await withTimeout(db.ref(`${ADMIN_PATH}/passHash`).once('value'), TIMEOUT_MS);
            const stored = snap.val();
            const input = await sha256(pass);
            if (!stored || input !== stored) {
                toast('Incorrect passphrase.', 'error');
                return;
            }
            sessionStorage.setItem(SESSION_KEY, stored);
            unlockPanel();
        } catch (err) {
            console.error('Gate check failed:', err);
            toast('Could not verify. Check your connection.', 'error');
        }
    }

    function unlockPanel() {
        $('gate').hidden = true;
        $('panel').hidden = false;
        loadUsers();
    }

    async function tryAutoUnlock() {
        const token = sessionStorage.getItem(SESSION_KEY);
        if (!token) return false;
        try {
            const snap = await withTimeout(db.ref(`${ADMIN_PATH}/passHash`).once('value'), TIMEOUT_MS);
            const stored = snap.val();
            if (stored && stored === token) {
                unlockPanel();
                return true;
            }
        } catch (_) { /* fall through */ }
        sessionStorage.removeItem(SESSION_KEY);
        return false;
    }

    function lock() {
        sessionStorage.removeItem(SESSION_KEY);
        location.reload();
    }

    /* ---------- User list ---------- */
    let users = []; // [{ key, email, name, password }]

    function emailFromKey(key) {
        // Best-effort reverse; users store name + password only, so this is
        // shown when we can't reconstruct the original email.
        return key.replace(/_/g, '.');
    }

    async function loadUsers() {
        $('loadState').hidden = false;
        $('errorState').hidden = true;
        $('emptyState').hidden = true;
        $('userList').hidden = true;

        try {
            const snap = await withTimeout(db.ref(DB_ROOT).once('value'), TIMEOUT_MS);
            const data = snap.val() || {};

            users = Object.entries(data).map(([key, val]) => ({
                key,
                email: val.email || emailFromKey(key),
                name: val.name || '',
                password: val.password || ''
            }));
            users.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));

            $('loadState').hidden = true;
            renderList();
        } catch (err) {
            console.error('Load failed:', err);
            $('loadState').hidden = true;
            $('errorState').hidden = false;
        }
    }

    function renderList() {
        const filter = ($('searchInput').value || '').trim().toLowerCase();
        const shown = filter
            ? users.filter((u) =>
                u.name.toLowerCase().includes(filter) ||
                u.email.toLowerCase().includes(filter) ||
                u.key.toLowerCase().includes(filter))
            : users;

        $('countLabel').textContent =
            `${shown.length} of ${users.length} user${users.length === 1 ? '' : 's'}`;

        if (users.length === 0) {
            $('emptyState').hidden = false;
            $('userList').hidden = true;
            return;
        }

        $('emptyState').hidden = true;
        $('userList').hidden = false;

        const ul = $('userList');
        ul.replaceChildren(...shown.map(buildRow));
    }

    function buildRow(u) {
        const li = document.createElement('li');
        li.className = 'user-row';

        const info = document.createElement('div');
        info.className = 'user-info';

        const name = document.createElement('div');
        name.className = 'user-name';
        name.textContent = u.name || '(no name)';

        const email = document.createElement('div');
        email.className = 'user-email';
        email.textContent = u.email;

        const key = document.createElement('div');
        key.className = 'user-key';
        key.textContent = `key: ${u.key}`;

        info.append(name, email, key);

        const actions = document.createElement('div');
        actions.className = 'user-actions';

        const editBtn = document.createElement('button');
        editBtn.className = 'icon-action ripple';
        editBtn.type = 'button';
        editBtn.title = 'Edit';
        editBtn.innerHTML = '<i class="fas fa-pen"></i>';
        editBtn.addEventListener('click', () => openEditor(u));

        const delBtn = document.createElement('button');
        delBtn.className = 'icon-action ripple danger';
        delBtn.type = 'button';
        delBtn.title = 'Delete';
        delBtn.innerHTML = '<i class="fas fa-trash"></i>';
        delBtn.addEventListener('click', () => deleteUser(u));

        actions.append(editBtn, delBtn);
        li.append(info, actions);
        return li;
    }

    $('searchInput').addEventListener('input', renderList);
    $('retryBtn').addEventListener('click', loadUsers);
    $('lockBtn').addEventListener('click', lock);

    /* ---------- Editor ---------- */
    const editorState = { mode: 'add', original: null };

    function openEditor(user) {
        editorState.mode = user ? 'edit' : 'add';
        editorState.original = user || null;

        $('editorTitle').textContent = user ? 'Edit user' : 'Add user';
        $('editorSaveLabel').textContent = user ? 'Save changes' : 'Create user';
        $('editName').value = user?.name || '';
        $('editEmail').value = user?.email || '';
        $('editPassword').value = user?.password || '';
        $('editEmail').disabled = false; // allow editing email (renames the key)
        $('emailHint').classList.remove('hidden');
        updateKeyPreview();

        $('editorScrim').hidden = false;
        $('editor').hidden = false;
        setTimeout(() => $('editName').focus(), 50);
    }

    function closeEditor() {
        $('editorScrim').hidden = true;
        $('editor').hidden = true;
        editorState.original = null;
    }

    function updateKeyPreview() {
        const email = $('editEmail').value.trim();
        $('keyPreview').textContent = email ? safeKey(email) : '—';
    }

    $('editEmail').addEventListener('input', updateKeyPreview);
    $('editorClose').addEventListener('click', closeEditor);
    $('editorCancel').addEventListener('click', closeEditor);
    $('editorScrim').addEventListener('click', closeEditor);
    $('addBtn').addEventListener('click', () => openEditor(null));

    $('pwToggle').addEventListener('click', () => {
        const input = $('editPassword');
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        const btn = $('pwToggle');
        btn.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
        btn.querySelector('i').className = showing ? 'fas fa-eye' : 'fas fa-eye-slash';
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !$('editor').hidden) closeEditor();
    });

    async function onEditorSubmit(e) {
        e.preventDefault();
        const name = $('editName').value.trim();
        const email = $('editEmail').value.trim();
        const password = $('editPassword').value;

        if (!name) return toast('Please enter a name.', 'error');
        if (!email || !EMAIL_RE.test(email)) return toast('Please enter a valid email.', 'error');
        if (!password || password.length < 4) return toast('Password must be at least 4 characters.', 'error');

        const key = safeKey(email);
        const payload = { name, email, password };

        const saveBtn = $('editorSave');
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="spinner"></span><span>Saving…</span>';

        try {
            if (editorState.mode === 'add') {
                const exists = await withTimeout(
                    db.ref(`${DB_ROOT}/${key}`).once('value'),
                    TIMEOUT_MS
                );
                if (exists.exists()) {
                    throw new Error('A user with this email already exists.');
                }
                await withTimeout(db.ref(`${DB_ROOT}/${key}`).set(payload), TIMEOUT_MS);
                toast('User created.', 'success');
            } else {
                const orig = editorState.original;
                if (orig.key !== key) {
                    // Email changed → move the whole node so userData moves with it
                    const snap = await withTimeout(db.ref(`${DB_ROOT}/${orig.key}`).once('value'), TIMEOUT_MS);
                    const existing = snap.val() || {};
                    const merged = { ...existing, ...payload };
                    const updates = {};
                    updates[`${DB_ROOT}/${key}`] = merged;
                    updates[`${DB_ROOT}/${orig.key}`] = null;
                    await withTimeout(db.ref().update(updates), TIMEOUT_MS);
                    toast('User updated and key moved.', 'success');
                } else {
                    await withTimeout(db.ref(`${DB_ROOT}/${key}`).update(payload), TIMEOUT_MS);
                    toast('User updated.', 'success');
                }
            }

            closeEditor();
            loadUsers();
        } catch (err) {
            console.error('Save failed:', err);
            toast(err.message || 'Could not save. Please try again.', 'error');
        } finally {
            saveBtn.disabled = false;
            saveBtn.innerHTML = `<i class="fas fa-floppy-disk"></i> <span id="editorSaveLabel">${
                editorState.mode === 'edit' ? 'Save changes' : 'Create user'
            }</span>`;
        }
    }

    $('editorForm').addEventListener('submit', onEditorSubmit);

    /* ---------- Delete ---------- */
    async function deleteUser(u) {
        const ok = await confirmBox(
            'Delete user?',
            `This removes <strong>${u.email}</strong> and everything under it (userData, KRA, reflection). Cannot be undone.`,
            'Delete'
        );
        if (!ok) return;

        try {
            await withTimeout(db.ref(`${DB_ROOT}/${u.key}`).remove(), TIMEOUT_MS);
            toast('User deleted.', 'success');
            loadUsers();
        } catch (err) {
            console.error('Delete failed:', err);
            toast('Could not delete. Please try again.', 'error');
        }
    }

    /* ---------- Wipe all ---------- */
    $('wipeBtn').addEventListener('click', async () => {
        if (users.length === 0) return toast('Nothing to delete.', 'info');

        const ok = await confirmBox(
            'Delete ALL users?',
            `This will wipe <strong>${users.length}</strong> user${users.length === 1 ? '' : 's'} and every entry under them. Cannot be undone.`,
            'Delete everything'
        );
        if (!ok) return;

        try {
            await withTimeout(db.ref(DB_ROOT).remove(), TIMEOUT_MS);
            toast('All users deleted.', 'success');
            loadUsers();
        } catch (err) {
            console.error('Wipe failed:', err);
            toast('Could not wipe. Please try again.', 'error');
        }
    });

    /* ---------- Toast styles (injected) ---------- */
    const style = document.createElement('style');
    style.textContent = `
        .toast {
            position: fixed;
            left: 50%;
            bottom: calc(24px + env(safe-area-inset-bottom, 0px));
            transform: translate(-50%, 20px);
            background: #171a20;
            color: #e6e8eb;
            border: 1px solid #2a3038;
            padding: 12px 18px;
            border-radius: 12px;
            font-size: 0.9rem;
            box-shadow: 0 12px 30px rgba(0,0,0,0.5);
            opacity: 0;
            transition: opacity .22s ease, transform .22s ease;
            z-index: 600;
            max-width: calc(100vw - 32px);
            text-align: center;
        }
        .toast.show { opacity: 1; transform: translate(-50%, 0); }
        .toast-error { border-color: #4a2a28; color: #ff9a8c; }
        .toast-success { border-color: #1f3a2e; color: #86e5b3; }
    `;
    document.head.append(style);

    /* ---------- Boot ---------- */
    $('gateForm').addEventListener('submit', onGateSubmit);

    (async () => {
        if (await tryAutoUnlock()) return;
        await checkGateMode();
        $('passInput').focus();
    })();
})();