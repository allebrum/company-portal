import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Load the REAL service worker source into a sandbox with a fake `self`,
// so these tests exercise exactly what ships (apps/web/sw/sw.js).
const SRC = fs.readFileSync(path.resolve(process.cwd(), 'sw/sw.js'), 'utf8');
type Handler = (e: unknown) => void;
function loadSw() {
  const handlers: Record<string, Handler[]> = {};
  const sandbox: Record<string, unknown> = {
    URL,
    Request: class { constructor(public url: string, public init?: unknown) {} },
    Response: class { constructor(public body: unknown, public init?: unknown) {} },
    caches: {},
    fetch: () => Promise.reject(new Error('no network in tests')),
    self: {
      location: { origin: 'https://app.hoppa.io' },
      registration: { active: null },
      clients: { claim: () => Promise.resolve() },
      skipWaiting: () => Promise.resolve(),
      addEventListener: (t: string, h: Handler) => ((handlers[t] ??= []).push(h)),
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return { strategyFor: sandbox.strategyFor as (m: string, u: string, mode: string, o: string) => string, handlers, sandbox };
}
const { strategyFor, handlers } = loadSw();
const O = 'https://app.hoppa.io';
const s = (url: string, mode = 'cors', method = 'GET') => strategyFor(method, url, mode, O);

test('the build placeholder is present (scripts/build-sw.mjs versions each build)', () => {
  assert.ok(SRC.includes("'__SW_VERSION__'"));
});

test('API, auth, OAuth, downloads and sockets are NEVER intercepted (network-only)', () => {
  for (const u of [
    `${O}/api/bootstrap`,
    `${O}/api/auth/me`,
    `${O}/api/auth/csrf`,
    `${O}/api/auth/google`,
    `${O}/api/auth/google/callback?code=x&state=y`,
    `${O}/api/files/123/download`,
    `${O}/api`,
    `${O}/socket.io/?EIO=4&transport=polling`,
  ]) {
    assert.equal(s(u), 'bypass', u);
    assert.equal(s(u, 'navigate'), 'bypass', `${u} (navigation)`);
  }
});

test('non-GET requests (uploads, CSRF writes, logout) are never intercepted', () => {
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(s(`${O}/api/uploads`, 'cors', m), 'bypass');
    assert.equal(s(`${O}/dashboard/`, 'navigate', m), 'bypass');
  }
});

test('cross-origin requests (separate API host, Google, fonts, analytics) are never intercepted', () => {
  for (const u of ['https://api.hoppa.io/api/bootstrap', 'https://accounts.google.com/o/oauth2/v2/auth', 'https://fonts.googleapis.com/css2', 'https://us.i.posthog.com/e/', 'https://app.hoppa.io.evil.com/_next/static/x.js']) {
    assert.equal(s(u), 'bypass', u);
    assert.equal(s(u, 'navigate'), 'bypass', u);
  }
});

test('/api look-alikes that are app pages are still treated as pages', () => {
  assert.equal(s(`${O}/apiary/`, 'navigate'), 'navigate');
  assert.equal(s(`${O}/api-tokens-help/`, 'navigate'), 'navigate');
});

test('page navigations are network-first; hashed assets cache-first; shell assets cached', () => {
  assert.equal(s(`${O}/dashboard/`, 'navigate'), 'navigate');
  assert.equal(s(`${O}/login/?returnTo=%2Fclients&expired=1`, 'navigate'), 'navigate');
  assert.equal(s(`${O}/_next/static/chunks/app/layout-abc123.js`), 'static');
  assert.equal(s(`${O}/_next/static/css/abc.css`), 'static');
  assert.equal(s(`${O}/offline.html`), 'shell');
  assert.equal(s(`${O}/site.webmanifest`), 'shell');
});

test('the worker script, RSC payloads and other files go to the network', () => {
  assert.equal(s(`${O}/sw.js`), 'bypass');
  assert.equal(s(`${O}/dashboard/index.txt?_rsc=abc`), 'bypass');
  assert.equal(s(`${O}/offline.html?v=2`), 'bypass');
  assert.equal(s('not a url'), 'bypass');
});

test('the fetch handler does not call respondWith for bypassed requests', () => {
  const fetchHandler = handlers.fetch![0]!;
  let responded = false;
  fetchHandler({
    request: { method: 'GET', url: `${O}/api/bootstrap`, mode: 'cors' },
    respondWith: () => { responded = true; },
  });
  assert.equal(responded, false);
  fetchHandler({
    request: { method: 'POST', url: `${O}/api/auth/logout`, mode: 'cors' },
    respondWith: () => { responded = true; },
  });
  assert.equal(responded, false);
});

test('no navigation preload (it would duplicate bypassed navigations like the OAuth start)', () => {
  assert.ok(!/navigationPreload\s*\.\s*enable/.test(SRC));
});

test('updates wait for the user: skipWaiting only on first install or on request', () => {
  assert.match(SRC, /if \(!self\.registration\.active\) return self\.skipWaiting\(\)/);
  assert.match(SRC, /data\.type === 'SKIP_WAITING'\) self\.skipWaiting\(\)/);
});
