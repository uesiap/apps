const CACHE_NAME = 'my-cache';
const urlsToCache = [
  '/',
  '/apps/uesi/staff-work/',
  '/vidhyardhi-geethavali/Icon192.jpg',
  '/vidhyardhi-geethavali/Icon512.jpg',
  '/vidhyardhi-geethavali/uesisongsmain.jpg'
];

// Install event
self.addEventListener('install', event => {
  console.log('Service Worker: Installing');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Cache opened');
        return cache.addAll(urlsToCache);
      })
  );
  self.skipWaiting(); // Activate new SW immediately
});

// Activate event
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker: Clearing old cache');
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Take control of clients immediately
  );
});

// Fetch event
self.addEventListener('fetch', event => {
  console.log('Service Worker: Fetching', event.request.url);
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          console.log('Service Worker: Cache hit');
          return response;
        }
        const fetchRequest = event.request.clone();
        return fetch(fetchRequest).then(response => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            console.log('Service Worker: Invalid response');
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            console.log('Service Worker: Caching new resource', event.request.url);
            cache.put(event.request, responseToCache);
          });
          return response;
        });
      }).catch(error => {
        console.error('Service Worker: Fetch error:', error);
      })
  );
});

// Push Notification Event
self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    data = { title: 'Notification', body: 'You have a new message!', url: '/' };
  }

  const title = data.title || 'New Message';
  const options = {
    body: data.body || '',
    icon: '/vidhyardhi-geethavali/Icon192.jpg',
    badge: 'https://cdn-icons-png.flaticon.com/512/9687/9687399.png',
    data: {
      url: data.url || '/'
    },
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click event handler
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const notificationData = event.notification.data;
  const action = event.action;

  // Check if a specific action and its configuration exist in the payload
  if (notificationData && notificationData.onActionClick && notificationData.onActionClick[action]) {
    const actionConfig = notificationData.onActionClick[action];

    // Determine the operation and perform the action
    if (actionConfig.operation === 'openWindow' && actionConfig.url) {
      event.waitUntil(clients.openWindow(actionConfig.url));
    } else if (actionConfig.operation === 'focusLastFocusedOrOpen' && actionConfig.url) {
      event.waitUntil(async () => {
        const urlToOpen = new URL(actionConfig.url, self.location.origin).href;
        const allClients = await clients.matchAll({ type: 'window' });
        const clientToFocus = allClients.find(client => client.url.includes(urlToOpen));

        if (clientToFocus) {
          return clientToFocus.focus();
        } else {
          return clients.openWindow(urlToOpen);
        }
      });
    } else if (actionConfig.operation === 'navigateLastFocusedOrOpen' && actionConfig.url) {
      event.waitUntil(async () => {
        const allClients = await clients.matchAll({ type: 'window' });
        const clientToFocus = allClients.find(client => client.focused);

        if (clientToFocus) {
          return clientToFocus.navigate(actionConfig.url);
        } else {
          return clients.openWindow(actionConfig.url);
        }
      });
    } else if (actionConfig.operation === 'sendRequest' && actionConfig.url) {
      event.waitUntil(fetch(actionConfig.url, { method: 'POST' }));
    }
  } else {
    // This handles the main body click (action is '') and any other undefined actions.
    // Use the default URL from the payload or fall back to the root ('/')
    const defaultUrl = notificationData?.url || '/';
    event.waitUntil(clients.openWindow(defaultUrl));
  }
});
