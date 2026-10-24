/* Hoppa service worker.
 *
 * Hand-written on purpose (no next-pwa / Workbox): the web app is a Next 14
 * static export, and all this needs to do is
 *   - cache the hashed, immutable /_next/static/* assets,
 *   - keep a tiny offline fallback page + icons,
 *   - and stay COMPLETELY out of the way of everything else.
 *
 * scripts/build-sw.mjs copies this file to out/sw.js after `next build`,
 * replacing __SW_VERSION__ with the Next build id, so every deploy produces
 * a byte-different sw.js -> the browser installs the new worker -> the page
 * shows "New version available · Reload" (src/components/pwa/PwaUpdate.tsx).
 *
 * NEVER handled (we don't call respondWith, so the browser does a normal
 * network request exactly as if there were no service worker):
 *   - any non-GET request (uploads, CSRF-protected writes, logout, …)
 *   - any cross-origin request (a separate API host, Google, Drive, PostHog)
 *   - same-origin /api/* and /socket.io/* (data, auth, OAuth redirects,
 *     file downloads, websockets)
 *   - /sw.js itself and Next's RSC payload fetches (index.txt?_rsc=…)
 */
'use strict';

var VERSION = '__SW_VERSION__';
var PREFIX = 'hoppa-';
var STATIC_CACHE = PREFIX + 'static-' + VERSION;
var SHELL_CACHE = PREFIX + 'shell-' + VERSION;
var OFFLINE_URL = '/offline.html';
var SHELL_ASSETS = [
  OFFLINE_URL,
  '/site.webmanifest',
  '/favicon.ico',
  '/favicon.svg',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
  '/maskable-512x512.png',
  '/apple-touch-icon.png',
];

/**
 * Decide how to handle a request. Pure, so it is unit-tested
 * (src/lib/pwa/__tests__/sw.test.ts loads this file in a sandbox).
 * Returns 'bypass' | 'static' | 'shell' | 'navigate'.
 */
function strategyFor(method, url, mode, swOrigin) {
  if (method !== 'GET') return 'bypass';
  var u;
  try { u = new URL(url); } catch (e) { return 'bypass'; }
  if (u.origin !== swOrigin) return 'bypass';
  var p = u.pathname;
  if (p === '/api' || p.indexOf('/api/') === 0) return 'bypass';
  if (p === '/socket.io' || p.indexOf('/socket.io/') === 0) return 'bypass';
  if (p === '/sw.js') return 'bypass';
  if (mode === 'navigate') return 'navigate';
  if (p.indexOf('/_next/static/') === 0) return 'static';
  if (SHELL_ASSETS.indexOf(p) !== -1 && !u.search) return 'shell';
  return 'bypass';
}

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // `cache: 'reload'` skips the HTTP cache so a deploy never precaches a
      // stale copy from the CDN/browser cache.
      return cache.addAll(SHELL_ASSETS.map(function (u) { return new Request(u, { cache: 'reload' }); }));
    }).then(function () {
      // First install (nothing controlling pages yet): activate right away.
      // Updates WAIT until the user clicks "Reload" (SKIP_WAITING below), so
      // a page never swaps code underneath someone mid-edit.
      if (!self.registration.active) return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k.indexOf(PREFIX) === 0 && k !== STATIC_CACHE && k !== SHELL_CACHE) return caches.delete(k);
        return undefined;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (event) {
  var data = event.data || {};
  if (data.type === 'SKIP_WAITING') self.skipWaiting();
  if (data.type === 'GET_VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
});

function cacheFirst(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        // Only keep complete, same-origin successes (never a 404 page, a
        // redirect, or a partial range response).
        if (res && res.status === 200 && res.type === 'basic') cache.put(request, res.clone());
        return res;
      });
    });
  });
}

function networkFirstNavigation(event) {
  return (async function () {
    try {
      // No navigation preload on purpose: a preload would also fire for the
      // navigations we bypass (/api/auth/google, downloads), duplicating
      // requests like the OAuth start. HTML is never cached: after a deploy the next navigation always
      // gets the new page from the network.
      return await fetch(event.request);
    } catch (err) {
      var cache = await caches.open(SHELL_CACHE);
      var offline = await cache.match(OFFLINE_URL);
      return offline || new Response('You are offline.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
    }
  })();
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var s = strategyFor(req.method, req.url, req.mode, self.location.origin);
  if (s === 'bypass') return; // browser default: straight to the network
  if (s === 'navigate') { event.respondWith(networkFirstNavigation(event)); return; }
  if (s === 'static') { event.respondWith(cacheFirst(req, STATIC_CACHE)); return; }
  if (s === 'shell') { event.respondWith(cacheFirst(req, SHELL_CACHE)); return; }
});
