// /apps/uesi/staff-work/v1/service-worker.js

const VERSION = 'uesi-staff-v1-2026-10-14-3';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const SHELL = [
    '/apps/uesi/staff-work/v1/',
    '/apps/uesi/staff-work/v1/login',
    '/apps/uesi/staff-work/v1/view/field-report',
    '/apps/uesi/staff-work/v1/view/itinerary',
    '/apps/uesi/staff-work/v1/gen/field-report',
    '/apps/uesi/staff-work/v1/gen/itinerary',
    '/apps/uesi/staff-work/v1/gen/final/field-report',
    '/apps/uesi/staff-work/v1/gen/final/itinerary',
    '/apps/uesi/staff-work/v1/settings/kra',
    '/apps/uesi/staff-work/v1/settings/reflection',
    '/apps/uesi/staff-work/v1/assets/styles/common.css',
    '/apps/uesi/staff-work/v1/assets/styles/index.css',
    '/apps/uesi/staff-work/v1/assets/styles/login.css',
    '/apps/uesi/staff-work/v1/assets/styles/gen.css',
    '/apps/uesi/staff-work/v1/assets/styles/final.css',
    '/apps/uesi/staff-work/v1/assets/styles/view.css',
    '/apps/uesi/staff-work/v1/assets/styles/settings.css',
    '/apps/uesi/staff-work/v1/assets/scripts/common.js',
    '/apps/uesi/staff-work/v1/assets/scripts/index.js',
    '/apps/uesi/staff-work/v1/assets/scripts/login.js',
    '/apps/uesi/staff-work/v1/assets/scripts/gen.js',
    '/apps/uesi/staff-work/v1/assets/scripts/final.js',
    '/apps/uesi/staff-work/v1/assets/scripts/view.js',
    '/apps/uesi/staff-work/v1/assets/scripts/settings-kra.js',
    '/apps/uesi/staff-work/v1/assets/scripts/settings-reflection.js',
    '/apps/uesi/staff-work/v1/manifest.json',
    'https://uesiap.github.io/apps/uesi/staff-work/assets/icons/uesi192.jpg'
];

const BYPASS_HOSTS = [
    'firebaseio.com',
    'firebaseapp.com',
    'googleapis.com',
    'gstatic.com',
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
];

const NOTIFICATION_ICON = 'https://uesiap.github.io/apps/uesi/staff-work/assets/icons/uesi192.jpg';
const DEFAULT_URL = '/apps/uesi/staff-work/v1/';

/* ---------- Install ---------- */
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then((cache) => cache.addAll(SHELL).catch(() => {}))
            .then(() => self.skipWaiting())
    );
});

/* ---------- Activate ---------- */
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => !k.startsWith(VERSION))
                    .map((k) => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

/* ---------- Fetch ---------- */
self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    if (BYPASS_HOSTS.some((host) => url.hostname.includes(host))) return;
    if (!url.pathname.startsWith('/apps/uesi/staff-work/v1/')) return;

    if (request.mode === 'navigate' || request.destination === 'document') {
        event.respondWith(
            fetch(request)
                .then((res) => {
                    const copy = res.clone();
                    caches.open(SHELL_CACHE).then((c) => c.put(request, copy)).catch(() => {});
                    return res;
                })
                .catch(() => caches.match(request).then((r) => r || caches.match('/apps/uesi/staff-work/v1/')))
        );
        return;
    }

    event.respondWith(
        caches.match(request).then((cached) => {
            if (cached) return cached;
            return fetch(request).then((res) => {
                if (res && res.status === 200 && res.type === 'basic') {
                    const copy = res.clone();
                    caches.open(RUNTIME_CACHE).then((c) => c.put(request, copy)).catch(() => {});
                }
                return res;
            });
        })
    );
});

/* ---------- Push ---------- */
self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch (_) {
        try { data = { body: event.data ? event.data.text() : '' }; } catch (_) {}
    }

    const title = data.title || 'UESI Staff Work';
    const options = {
        body: data.body || '',
        icon: data.icon || NOTIFICATION_ICON,
        badge: data.badge || NOTIFICATION_ICON,
        tag: data.tag || 'uesi-general',
        renotify: Boolean(data.tag),
        data: { url: data.url || DEFAULT_URL }
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

/* ---------- Notification click ---------- */
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = event.notification.data?.url || DEFAULT_URL;

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                for (const client of clientList) {
                    if (client.url.startsWith('/apps/uesi/staff-work/v1/') && 'focus' in client) {
                        return client.focus();
                    }
                }
                if (self.clients.openWindow) {
                    return self.clients.openWindow(target);
                }
            })
    );
});