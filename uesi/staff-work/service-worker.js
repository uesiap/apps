const CACHE_NAME = 'my-cache';
const urlsToCache = [
  '/',
  '/apps/uesi/staff-work/',
  '/vidhyardhi-geethavali/Icon192.jpg',
  '/vidhyardhi-geethavali/Icon512.jpg',
  '/vidhyardhi-geethavali/uesisongsmain.jpg'  // Add the splash screen image to the cache
];

// Install event
self.addEventListener('install', event => {
  console.log('Service Worker: Installing');
  // Perform install steps
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker: Cache opened');
        return cache.addAll(urlsToCache);
      })
  );
});

// Activate event
self.addEventListener('activate', event => {
  console.log('Service Worker: Activating');
  // Remove old caches
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
    })
  );
});

// Fetch event
self.addEventListener('fetch', event => {
  console.log('Service Worker: Fetching');
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          console.log('Service Worker: Cache hit');
          return response;
        }

        // Clone the request because it's a stream
        const fetchRequest = event.request.clone();

        return fetch(fetchRequest).then(
          response => {
            // Check if we received a valid response
            if (!response || response.status !== 200 || response.type !== 'basic') {
              console.log('Service Worker: Invalid response');
              return response;
            }

            // Clone the response because it's a stream
            const responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                console.log('Service Worker: Caching new resource');
                cache.put(event.request, responseToCache);
              });

            return response;
          }
        );
      })
      .catch(error => {
        console.error('Service Worker: Fetch error:', error);
      })
  );
});
