// GeoAttend offline support.
//
// Keeps a copy of the staff page (/staff) and the admin page (/) plus the
// files they load, so the staff page opens with no internet (no mobile data,
// Wi-Fi without internet). Every online visit refreshes the copy, so a new
// deploy shows up on the next load, and files from old deploys are removed.
// The page itself saves sign-ins made offline and sends them later.
//
// Only this site's own GET requests are handled. API calls (another domain),
// Google sign-in and everything else go straight to the network.

const CACHE = 'geoattend-v3';
const PAGES = ['/staff', '/'];
const EXTRAS = ['/icon-192.png', '/icon-512.png', '/manifest.json', '/staff-manifest.json'];
// On Wi-Fi with no internet a request can hang for a long time: after this
// long, show the saved page instead of a blank screen
const PAGE_TIMEOUT_MS = 6000;

const isStaffPath = (pathname) => pathname === '/staff' || pathname.startsWith('/staff/') || pathname === '/staff.html';
const pageKey = (pathname) => (isStaffPath(pathname) ? '/staff' : '/');

/** The /static/... files an HTML page loads. */
function assetsIn(html) {
  const found = new Set();
  const re = /(?:src|href)="(\/static\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html))) found.add(m[1]);
  return [...found];
}

/** Saves a fresh page and its files, then drops files no saved page uses. */
async function savePage(key, response) {
  const cache = await caches.open(CACHE);
  const html = await response.clone().text();
  await cache.put(key, response.clone());
  await Promise.allSettled(assetsIn(html).map(async (url) => {
    if (await cache.match(url)) return;
    const res = await fetch(url);
    if (res.ok) await cache.put(url, res);
  }));
  // Prune files from old deploys
  const keep = new Set();
  for (const page of PAGES) {
    const saved = await cache.match(page);
    if (saved) assetsIn(await saved.text()).forEach((u) => keep.add(u));
  }
  const keys = await cache.keys();
  await Promise.all(keys
    .filter((req) => new URL(req.url).pathname.startsWith('/static/') && !keep.has(new URL(req.url).pathname))
    .map((req) => cache.delete(req)));
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(EXTRAS.map((u) => cache.add(u)));
    await Promise.allSettled(PAGES.map(async (page) => {
      const res = await fetch(page, { cache: 'reload' });
      if (res.ok) await savePage(page, res);
    }));
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

async function savedPageFor(pathname) {
  const cache = await caches.open(CACHE);
  if (isStaffPath(pathname)) {
    return (await cache.match('/staff')) || (await cache.match('/'));
  }
  return (await cache.match('/')) || (await cache.match('/staff'));
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch { return; }
  if (url.origin !== self.location.origin) return;

  // Pages: network first (new deploys show at once), saved copy when offline
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const network = fetch(request);
      try {
        const res = await withTimeout(network, PAGE_TIMEOUT_MS);
        if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
          event.waitUntil(savePage(pageKey(url.pathname), res.clone()).catch(() => {}));
        }
        return res;
      } catch {
        const saved = await savedPageFor(url.pathname);
        if (saved) {
          // Still refresh the saved copy if the slow network answers later
          event.waitUntil(network.then((res) => (res.ok ? savePage(pageKey(url.pathname), res) : null)).catch(() => {}));
          return saved;
        }
        return network; // nothing saved yet: let the browser show its own error
      }
    })());
    return;
  }

  // Built files (names change on every deploy): saved copy first
  if (url.pathname.startsWith('/static/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const saved = await cache.match(request);
      if (saved) return saved;
      const res = await fetch(request);
      if (res.ok) cache.put(request, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }

  // Icons, manifests: network first, saved copy when offline
  if (EXTRAS.includes(url.pathname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone()).catch(() => {});
        return res;
      } catch {
        return (await cache.match(request)) || Response.error();
      }
    })());
  }
});
