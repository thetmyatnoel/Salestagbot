/**
 * app/sw.js — the service worker: the shell works with no network at all.
 *
 * Precache (install): every file of the shell, listed by the build with a version stamp. Cache-first for
 * the shell, network-only for the API (any request that is not to this origin, or that carries ?api=)
 * and for anything not in the precache (ping.html, version.json fetched by the page).
 * Update: a new sw.js installs its own `shell-<version>` cache and WAITS. The page activates it only on a
 * cold start when the outbox is empty and no multi-step flow is open (postMessage SKIP_WAITING), then
 * reloads once; never mid-sale, no banner to tap (SPEC section 2). Old shell caches are removed on activate.
 * The two lines marked @sw-version / @sw-precache are rewritten by tools/build_app.js. Plain ES5.
 */
var SW_VERSION = "1.0.0+1f6d909b84"; // @sw-version
var SW_PRECACHE = ["index.html","app.1f6d909b84.js","app.css?v=1.0.0+1f6d909b84","manifest.webmanifest","config.js","version.json","fonts/IBMPlexSans-latin-e2291e84.woff2","fonts/IBMPlexSans-latin-ext-d160e209.woff2","fonts/NotoSansMyanmar-latin-9831ab28.woff2","fonts/NotoSansMyanmar-myanmar-c1453c36.woff2","fonts/fonts.css","vendor/jsQR.js","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","icons/icon.svg"]; // @sw-precache
var SW_CACHE = 'shell-' + SW_VERSION;

function swPrecacheRequest(url) {
  try { return new Request(url, { cache: 'reload' }); } catch (err) { return url; }
}

self.addEventListener('install', function (ev) {
  ev.waitUntil(caches.open(SW_CACHE).then(function (cache) {
    return Promise.all(SW_PRECACHE.map(function (url) {
      return cache.add(swPrecacheRequest(url)).then(null, function () { return cache.add(url); });
    }));
  }));
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('shell-') === 0 && k !== SW_CACHE; }).map(function (k) { return caches['delete'](k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (ev) {
  var data = ev.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'VERSION' && ev.source && ev.source.postMessage) ev.source.postMessage({ type: 'VERSION', version: SW_VERSION });
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;                         // the API is POST: never cached, never intercepted
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;          // script.google.com and its redirect: network only
  if (url.searchParams.has('api')) return;
  if (req.mode === 'navigate') {
    var isShell = /\/(index\.html)?$/.test(url.pathname);
    ev.respondWith(caches.match(isShell ? 'index.html' : req, { ignoreSearch: true }).then(function (hit) { return hit || fetch(req); }));
    return;
  }
  ev.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
    return hit || fetch(req);
  }));
});
