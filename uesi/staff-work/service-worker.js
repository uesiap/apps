
const CACHE_NAME = 'uesi-staff-work-cache-v3';
const APP_URL = 'https://uesiap.github.io/apps/uesi/staff-work/';
const urlsToCache = [
  'https://uesiap.github.io/',
  APP_URL,
  'https://uesiap.github.io/apps/uesi/staff-work/assets/icons/uesi192.jpg',
  'https://uesiap.github.io/apps/uesi/staff-work/assets/icons/uesi512.jpg',
  'https://uesiap.github.io/apps/uesi/staff-work/assets/icons/uesiSplash.jpg'
];

// Install event

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(async cache => {
        for (const url of urlsToCache) {
          try {
            const response = await fetch(url);

            if (response.ok) {
              await cache.put(url, response);
            } else {
              console.warn('Cache skipped:', url, response.status);
            }
          } catch (error) {
            console.warn('Cache skipped:', url, error);
          }
        }
      })
      .then(() => self.skipWaiting())
  );
});


// Activate event
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames =>
        Promise.all(
          cacheNames
            .filter(name =>
              name.startsWith('uesi-staff-work-cache-') &&
              name !== CACHE_NAME
            )
            .map(name => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Fetch event
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;

        return fetch(event.request).then(response => {
          if (
            response &&
            response.status === 200 &&
            response.type === 'basic'
          ) {
            const copy = response.clone();
            event.waitUntil(
              caches.open(CACHE_NAME)
                .then(cache => cache.put(event.request, copy))
            );
          }

          return response;
        });
      })
  );
});

// Push notification event
self.addEventListener('push', event => {
  let data = {};

  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {
      body: event.data ? event.data.text() : ''
    };
  }

  const title = data.title || 'UESI Staff';
  const options = {
    body: data.body || "Please submit your today's field report in the App.",
    icon: 'https://uesiap.github.io/apps/uesi/staff-work/assets/icons/uesi192.jpg',
    badge: 'https://uesiap.github.io/apps/uesi/staff-work/assets/icons/badge.png',
    data: {
      url: data.url || APP_URL
    }
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || APP_URL;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        for (const client of windowClients) {
          if (client.url.startsWith(APP_URL) && 'focus' in client) {
            return client.navigate(targetUrl).then(() => client.focus());
          }
        }

        return clients.openWindow(targetUrl);
      })
  );
});
