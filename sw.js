// Bump this version string every time you deploy a change to a cached file.
// Changing it forces the browser to treat this as a new service worker,
// which clears out old cached files and lets your update actually reach
// the installed app on your phone.
const CACHE_NAME = 'gardening-v7';

// Scope-relative paths (no leading slash) so they resolve correctly whether the
// app is served from /what-gardening-today/ or /what-gardening-today-dev/.
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
  './assets/icons/favicon-32.png',
  './assets/icons/favicon.ico'
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
  const req = e.request;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Only ever touch our OWN app-shell files (same origin, GET requests).
  // Everything else — Supabase auth/database/function calls, OpenWeather icons,
  // postcodes.io lookups — is left to go straight to the network, untouched and
  // uncached. Caching authenticated API responses would be both stale and leaky.
  if (req.method !== 'GET' || !sameOrigin) {
    return; // no respondWith() → default browser network handling
  }

  // Network-first for our own files: always try the latest from the server,
  // and fall back to the cached copy only if the network fails (e.g. you're
  // offline in the garden with no signal).
  e.respondWith(
    fetch(req)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(req, clone));
        return response;
      })
      .catch(() => caches.match(req))
  );
});
