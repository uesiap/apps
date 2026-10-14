// /apps/uesi/staff-work/v1/service-worker.js

const VERSION = 'uesi-staff-v1-2026-10-14-1';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

const SHELL = [
    '/apps/uesi/staff-work/v1/',
    '/apps/uesi/staff-work/v1/index.html',
    '/apps/uesi/staff-work/v1/login.html',
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

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then((cache) => cache.addAll(SHELL).catch(() => {}))
            .then(() => self.skipWaiting())
    );
});

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

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);

    // Let the network handle Firebase, fonts, CDNs — never cache them
    if (BYPASS_HOSTS.some((host) => url.hostname.includes(host))) return;

    // Only handle our own /v1/ origin
    if (!url.pathname.startsWith('/apps/uesi/staff-work/v1/')) return;

    // Network-first for HTML so updates land quickly
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

    // Cache-first for static assets
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