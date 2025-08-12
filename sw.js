/*
 * Simple service worker for offline support. It precaches a fixed list of
 * assets including the core game files and third‑party libraries. On
 * fetch events it serves cached resources first, falling back to the
 * network when necessary. This is a basic implementation suitable for
 * the prototype; later iterations can integrate Workbox and runtime
 * caching strategies as the asset list grows.
 */

// Bump the cache version whenever assets or service worker logic changes. The
// CACHE_VERSION string is appended to the cache name. Changing it forces
// browsers to drop old caches on the next activation.
const CACHE_VERSION = 'v2';
const CACHE_NAME = 'arcade-football-cache-' + CACHE_VERSION;
const PRECACHE_URLS = [
  '/',
  'index.html',
  'style.css',
  'main.js',
  'physicsWorker.js',
  'manifest.json',
  'sw.js',
  'icons/icon-192.png',
  'icons/icon-512.png',
  // Third‑party libraries pinned to specific versions. These are
  // requested with `no-cors` and stored as opaque responses.
  'https://cdn.jsdelivr.net/npm/pixi.js@8.0.0/dist/pixi.min.js',
  'https://cdn.jsdelivr.net/npm/@rive-app/canvas@2.25.2/rive.min.js',
  'https://cdn.jsdelivr.net/npm/box2d-wasm@7.0.0/dist/umd/Box2D.js',
  'https://cdn.jsdelivr.net/npm/box2d-wasm@7.0.0/dist/umd/Box2D.wasm'
  ,
  // Generated character textures used for selectable avatars
  'assets/characters/player1.png',
  'assets/characters/player2.png',
  'assets/characters/player3.png',
  'assets/characters/player4.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => {
      // Activate new worker immediately
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName.startsWith('arcade-football-cache-') && cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Allow the page to trigger skipWaiting via message. The main script can
// postMessage({type:'SKIP_WAITING'}) to the waiting service worker when a new
// version is ready.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      // Cache hit – return the response; otherwise fetch from network.
      return response || fetch(event.request);
    })
  );
});