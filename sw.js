// ----- Version & cache names -----
const VERSION = 'v2';
const STATIC_CACHE = `ps-static-${VERSION}`;
const RUNTIME_CACHE = `ps-runtime-${VERSION}`;

// ----- Files to precache (must exist at these paths) -----
const PRECACHE = [
  '/',                    // homepage
  '/index.html',
  '/styles.css?v=61',
  '/script.js?v=61',
  '/logo.svg',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-1024.png'
  // If you later add an offline page, also add:
  // '/offline.html'
];

// ----- Install: pre-cache app shell -----
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// ----- Activate: clean up old caches -----
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => ![STATIC_CACHE, RUNTIME_CACHE].includes(k) && k.startsWith('ps-'))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// Utility: network-first for HTML navigations
async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    const cache = await caches.open(RUNTIME_CACHE);
    // Clone response before putting in cache
    cache.put(request, fresh.clone());
    return fresh;
  } catch (err) {
    // Fallback to cache; if not found, try offline page
    const cached = await caches.match(request);
    if (cached) return cached;

    // If you added /offline.html to PRECACHE, use it here:
    const offline = await caches.match('/offline.html');
    if (offline) return offline;

    // Last resort: simple fallback
    return new Response('<h1>Offline</h1><p>Please reconnect and try again.</p>', {
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      status: 503
    });
  }
}

// Utility: stale-while-revalidate for static assets (css/js/img/fonts)
async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((response) => {
      // Only cache good same-origin responses
      if (response && response.status === 200 && response.type === 'basic') {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  return cached || fetchPromise || fetch(request);
}

// ----- Fetch handler -----
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // 1) Navigations (HTML pages): network-first
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req));
    return;
  }

  // 2) Same-origin static assets: stale-while-revalidate
  if (sameOrigin) {
    const dest = req.destination;
    if (['style', 'script', 'font', 'image'].includes(dest)) {
      event.respondWith(staleWhileRevalidate(req));
      return;
    }

    // Manifest, SVG, JSON, etc.: also stale-while-revalidate
    if (['manifest'].includes(dest) || url.pathname.endsWith('.svg') || url.pathname.endsWith('.json')) {
      event.respondWith(staleWhileRevalidate(req));
      return;
    }
  }

  // 3) Everything else: try cache first, then network
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req))
  );
});

// Optional: allow pages to trigger immediate activation after update
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
