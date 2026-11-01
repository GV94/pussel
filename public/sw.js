// Service worker: makes Pussel work offline.
//
// - The app itself (HTML, JS, CSS, icons) and the bundled sample pictures are
//   stored on install.
// - Pictures from Wikimedia Commons are stored the first time they are shown,
//   so a picture that has been opened or played keeps working offline.
// - Commons searches go to the network first and fall back to the last answer.

const VERSION = 'v2';
const SHELL = `pussel-shell-${VERSION}`;
const IMAGES = 'pussel-images'; // kept across versions
const API = 'pussel-api';
const MAX_IMAGES = 120;

const BASE = new URL(self.registration.scope).pathname; // e.g. /pussel/

const SAMPLE_FILES = [];
for (let i = 1; i <= 8; i++) SAMPLE_FILES.push(`samples/sample-${i}.jpg`, `samples/sample-${i}-thumb.jpg`);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      const fixed = ['', 'manifest.webmanifest', 'icon.svg', 'icon-180.png', 'icon-512.png', 'samples/credits.json', ...SAMPLE_FILES];
      await cache.addAll(fixed.map((f) => BASE + f));
      // The built JS and CSS have hashed names; read them out of index.html.
      const html = await (await cache.match(BASE)).text();
      const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
      await cache.addAll(assets);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('pussel-shell-') && key !== SHELL) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Opening the app: try the network for the newest version, else the stored copy.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(BASE, copy));
          return res;
        })
        .catch(async () => (await caches.match(BASE)) ?? Response.error()),
    );
    return;
  }

  if (url.origin === location.origin) {
    event.respondWith(cacheFirst(req, SHELL));
    return;
  }

  if (url.hostname === 'upload.wikimedia.org' || url.hostname === 'thumb.wikimedia.org') {
    event.respondWith(image(req));
    return;
  }

  if (url.hostname === 'commons.wikimedia.org' && url.pathname.endsWith('/api.php')) {
    event.respondWith(networkFirst(req, API));
  }
});

async function cacheFirst(req, cacheName) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(cacheName)).put(req, res.clone());
  return res;
}

async function networkFirst(req, cacheName) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(cacheName)).put(req, res.clone());
    return res;
  } catch {
    const hit = await caches.match(req);
    if (!hit) return Response.error();
    // Tell the page this answer is stored, not fresh: it means we're offline.
    const headers = new Headers(hit.headers);
    headers.set('X-Pussel-Offline', '1');
    return new Response(await hit.blob(), { status: hit.status, headers });
  }
}

/**
 * Commons pictures. The page loads them as plain <img>, which would give an
 * opaque response; fetching with CORS (Commons allows it) gives a normal one
 * that is cheap to store.
 */
async function image(req) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  let res;
  try {
    res = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
  } catch {
    return fetch(req); // let the browser report the failure as usual
  }
  if (res.ok) {
    await cache.put(req.url, res.clone());
    trim(cache);
  }
  return res;
}

async function trim(cache) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_IMAGES; i++) await cache.delete(keys[i]);
}
