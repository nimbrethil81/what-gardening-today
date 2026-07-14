// Bump this version string every time you deploy a change.
// Changing it forces the browser to treat this as a new service worker,
// which clears out old cached files and lets your update actually reach
// the installed app on your phone.
const CACHE_NAME = 'gardening-v3';

const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
  '/assets/icons/icon-192.png',
  '/assets/icons/icon-512.png',
  '/assets/icons/apple-touch-icon.png',
  '/assets/icons/favicon-32.png',
  '/assets/icons/favicon.ico'
];

self.addEventListener('install', e => {
  // Activate the new service worker as soon as it finishes installing,
  // rather than waiting for every open tab/instance of the app to be closed.
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', e => {
  // Delete any caches left over from a previous version, and take control
  // of any already-open pages immediately.
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Network-first: always try to get the latest version from the server.
  // Only fall back to the cached copy if the network request fails
  // (e.g. you're offline in the garden with no signal).
  e.respondWith(
    fetch(e.request)
      .then(response => {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(e.request, responseClone));
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});
