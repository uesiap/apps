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
    badge: 'https://whatpwacando.today/src/img/icons/notification.png',
    data: {
      url: data.url || '/'
    },
    // actions: [
    //   { action: 'open', title: 'Open' },
    //   { action: 'dismiss', title: 'Dismiss' }
    // ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Notification click event handler
self.addEventListener('notificationclick', event => {
  event.notification.close();

  const action = event.action;
  const notificationData = event.notification.data;

  // Handle the 'dismiss' action explicitly
  if (action === 'dismiss') {
    // The notification is already closed by event.notification.close(), so we do nothing else.
    return;
  }

  // Handle the 'open' action and the main body click
  if (action === 'open' || action === '') {
    const url = notificationData.url || '/';

    event.waitUntil(async () => {
      const allClients = await clients.matchAll({ type: 'window' });

      // Check if a client is already open and try to focus it
      const clientToFocus = allClients.find(client => client.url.includes(url));

      if (clientToFocus) {
        return clientToFocus.focus();
      } else {
        // If not, open a new window
        return clients.openWindow(url);
      }
    });
  }
});
