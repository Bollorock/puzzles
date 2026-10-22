// Offline support: the app shell is cached on install, other same-origin
// requests are served cache-first, and the Picsum photo list falls back to
// the last cached copy when offline.
const VERSION = 'puzzles-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(VERSION);
      await cache.addAll(SHELL);
      // Also cache the hashed JS/CSS bundles referenced by index.html.
      const html = await (await fetch('./index.html', { cache: 'no-cache' })).text();
      const assets = [...html.matchAll(/(?:src|href)="(\.?\/?assets\/[^"]+)"/g)].map((m) => m[1]);
      await cache.addAll(assets);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

const put = (req, res) => {
  const copy = res.clone();
  void caches.open(VERSION).then((c) => c.put(req, copy));
};

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') {
    // Network first so new deployments show up; cached shell when offline.
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) put('./index.html', res);
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
  } else if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) put(req, res);
            return res;
          }),
      ),
    );
  } else if (url.hostname === 'picsum.photos' && url.pathname.startsWith('/v2/list')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) put(req, res);
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error())),
    );
  }
});
