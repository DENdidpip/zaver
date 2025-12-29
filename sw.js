// Tangram PWA Service Worker
const CACHE_NAME = 'tangram-game-v1.0.0';
const urlsToCache = [
  './',
  './index.html',
  './menu.html',
  './src/index.js',
  './styles/index.css',
  './json/levels.json',
  './manifest.json'
];

// Inštalácia Service Worker
self.addEventListener('install', event => {
  console.log('[SW] Inštalácia Service Worker');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Ukladanie súborov do cache');
        return cache.addAll(urlsToCache);
      })
      .catch(err => {
        console.warn('[SW] Chyba pri ukladaní do cache:', err);
        // Neblokujeme inštaláciu pri chybách cache
        return Promise.resolve();
      })
  );
});

// Aktivácia Service Worker
self.addEventListener('activate', event => {
  console.log('[SW] Aktivácia Service Worker');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          // Odstraňujeme staré cache
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Odstraňovanie starého cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Spracovanie sieťových požiadaviek
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Ak je súbor v cache, vrátime ho
        if (response) {
          console.log('[SW] Načítanie z cache:', event.request.url);
          return response;
        }

        // Inak načítame zo siete
        console.log('[SW] Načítanie zo siete:', event.request.url);
        return fetch(event.request).then(response => {
          // Kontrolujeme validitu odpovede
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }

          // Klonujeme odpoveď pre cache
          const responseToCache = response.clone();

          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });

          return response;
        });
      }
    )
  );
});

// Обработка сообщений от основного потока
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Уведомления о новых версиях
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({
      version: CACHE_NAME
    });
  }
});