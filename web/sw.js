// The service worker: konfetti starts and works offline once it has been opened online.
// The project changes every day, so the app's own files are network-first: online, a fresh copy
// always wins and the cache is only the fallback. That goes for three.js too, which is a file of ours
// under vendor/. Change VERSION whenever this file changes how or what it caches; a new VERSION
// throws the old cache away. Changing the editor's files needs no new VERSION.
const VERSION = 3;
// Named after the scope too: copies on one host (user.github.io/konfetti/, /a-fork/) keep apart.
const CACHE = `konfetti-${VERSION} ${self.registration.scope}`;
// ms to wait for the network before falling back to a cached copy. ponytail: on a link slower than
// this, a start can mix fresh and cached files; the late answers still land in the cache for next time.
const WAIT = 3000;

// What a first visit may not have fetched yet but should open offline. Everything else the editor
// loads (modules, styles, wasm) the page sends over once this worker controls it. three.js is listed:
// a page from before it moved into vendor/ may be the one that installs this worker, and it never
// loaded those files, while the './' cached here needs them.
const PAGES = ['./', 'docs.html', 'vendor/three/build/three.module.js', 'vendor/three/examples/jsm/controls/OrbitControls.js',
  ...['hello', 'cat', 'count', 'dad', 'countdown', 'compare', 'reverse', 'aventyret', '8ball'].map(n => `../examples/${n}.kft`)];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Each file on its own: one missing file must not stop the worker from installing.
    const keep = url => fetch(url, { cache: 'no-cache' }).then(res => res.ok && cache.put(key(url), res)).catch(() => {});
    await Promise.all(PAGES.map(keep));
    // Learn mode loads every lesson at once, so offline it needs them all; the index names them.
    const index = await fetch('../lessons/index.json', { cache: 'no-cache' }).then(r => r.json()).catch(() => []);
    await Promise.all(['../lessons/index.json', ...index.flatMap(l => [`../lessons/${l.id}.start.kft`, `../lessons/${l.id}.solution.kft`])].map(keep));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.endsWith(` ${self.registration.scope}`) && name !== CACHE) await caches.delete(name);
    await self.clients.claim();
  })());
});

// The page sends the URLs it loaded before this worker took over (see pwa.js).
self.addEventListener('message', e => {
  if (!Array.isArray(e.data && e.data.loaded)) return;
  e.waitUntil(caches.open(CACHE).then(cache => Promise.all(e.data.loaded.filter(ours).map(async url => {
    if (await cache.match(key(url))) return;
    const res = await fetch(url).catch(() => null);
    if (res && res.ok) await cache.put(key(url), res);
  }))));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !ours(req.url)) return; // the weather and anything else: straight to the network
  const { net, saved } = fresh(req);
  e.waitUntil(saved.catch(() => {})); // an answer that comes too late still refreshes the cache
  e.respondWith(networkFirst(req, net).then(recheck));
});

/** Our own files: everything the editor needs. Nothing from another origin is ever cached. */
function ours(href) {
  return new URL(href).origin === location.origin;
}

/** The cache key: the URL without its query, so ?theme=arcade and the plain page share a copy. */
function key(href) {
  const url = new URL(href, location.href);
  return url.origin + url.pathname;
}

/**
 * Asks the server, revalidating rather than trusting the browser's heuristic cache. `net` is the
 * answer, as soon as it starts; `saved` settles once a good answer is in the cache too.
 */
function fresh(req) {
  let saving = null;
  const net = fetch(req, { cache: 'no-cache' }).then(res => {
    if (res.ok) {
      const copy = res.clone();
      saving = caches.open(CACHE).then(cache => cache.put(key(req.url), copy));
    }
    return res;
  });
  return { net, saved: net.then(() => saving) };
}

async function networkFirst(req, net) {
  const cached = await caches.match(key(req.url));
  if (!cached) return net; // nothing to fall back on: wait for the network however long it takes
  const late = new Promise(resolve => setTimeout(() => resolve(cached), WAIT));
  return Promise.race([net.catch(() => cached), late]);
}

/**
 * On a reload the browser reuses files the last page used, without asking this worker, for as long as
 * its heuristics call them fresh (minutes to hours), so a changed file would be missed. Marked no-cache,
 * they are asked for every time, and this worker answers from the network.
 */
function recheck(res) {
  if (res.status !== 200 || res.redirected) return res;
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'no-cache');
  return new Response(res.body, { status: 200, statusText: res.statusText, headers });
}
