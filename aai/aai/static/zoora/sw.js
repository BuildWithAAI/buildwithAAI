/* Zoora offline shell — caches static HUD assets only. Never caches /api/*.
   Scope: / (Service-Worker-Allowed). Localhost / paper-only HUD. */
'use strict';
const CACHE = 'zoora-shell-v3';
const PRECACHE = [
  '/zoora?noboot=1&nosse=1',
  '/static/zoora/offline.html',
  '/static/zoora/offline.css',
  '/static/zoora/zoora.css',
  '/static/zoora/zoora.js',
  '/static/zoora/zoora-voice.js',
  '/static/zoora/sessions.js',
  '/static/zoora/favicon.svg',
  '/static/zoora/icon-192.png',
  '/static/zoora/icon-512.png',
  '/static/zoora/manifest.webmanifest',
  '/static/zoora/fonts/Orbitron-VariableFont_wght.ttf',
  '/static/zoora/fonts/Rajdhani-Regular.ttf',
  '/static/zoora/fonts/Rajdhani-SemiBold.ttf',
  '/static/zoora/fonts/JetBrainsMono-VariableFont_wght.ttf',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async (u) => {
      try {
        const res = await fetch(u, { cache: 'reload', credentials: 'same-origin' });
        if (res && res.ok) await c.put(u, res.clone());
      } catch (_) { /* first install may race HUD boot; runtime fetch fills gaps */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

function isApi(url) {
  return url.pathname.startsWith('/api/');
}
function isShellAsset(url) {
  if (url.pathname.startsWith('/static/zoora/')) return true;
  if (url.pathname === '/zoora' || url.pathname === '/' || url.pathname === '/sw.js') return true;
  if (url.pathname === '/zoora/manifest.webmanifest') return true;
  return false;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (isApi(url)) return; // network only — never cache live data / auth responses

  // Navigations: network-first, fall back to cached shell then offline.html
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const c = await caches.open(CACHE);
          // store a stable key for /zoora so offline reopen works
          if (url.pathname === '/zoora' || url.pathname === '/') {
            c.put('/zoora?noboot=1&nosse=1', fresh.clone());
          }
          return fresh;
        }
      } catch (_) { /* offline */ }
      const c = await caches.open(CACHE);
      return (await c.match('/zoora?noboot=1&nosse=1'))
        || (await c.match('/static/zoora/offline.html'))
        || new Response('Zoora offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    })());
    return;
  }

  if (!isShellAsset(url)) return;

  // Static shell: cache-first, then network
  event.respondWith((async () => {
    const c = await caches.open(CACHE);
    // A versioned request (?v=<build>) only hits its exact cached copy, so a new HUD build is never shadowed by the
    // old bare-path entry. The bare path stays as the offline fallback for whichever build loaded last.
    const bare = url.pathname;
    const versioned = url.searchParams.has('v');
    const hit = versioned ? await c.match(req) : (await c.match(req) || await c.match(bare));
    if (hit) return hit;
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok) {
        if (versioned) await c.put(req, fresh.clone());
        await c.put(bare, fresh.clone());
        return fresh;
      }
      return fresh;
    } catch (_) {
      return (await c.match(bare)) || (await c.match('/static/zoora/offline.html'))
        || new Response('', { status: 503 });
    }
  })());
});
