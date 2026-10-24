import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError, isSessionPath, onUnauthorized, setSessionLost } from '../api';

let calls: string[] = [];
let status = 401;
beforeEach(() => {
  calls = [];
  status = 401;
  setSessionLost(false);
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ error: status === 401 ? 'unauthorized' : 'ok' }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
});

test('a staff 401 notifies listeners and still throws the ApiError', async () => {
  const seen: string[] = [];
  const off = onUnauthorized((e) => seen.push(e.path ?? ''));
  await assert.rejects(api.get('/bootstrap'), (e: unknown) => e instanceof ApiError && e.status === 401);
  off();
  assert.deepEqual(seen, ['/bootstrap']);
});

test('auth, portal and public-upload 401s are not session loss', async () => {
  const seen: string[] = [];
  const off = onUnauthorized((e) => seen.push(e.path ?? ''));
  for (const p of ['/auth/login', '/auth/me', '/auth/2fa/verify', '/portal/me', '/upload/qr/abc']) {
    await assert.rejects(api.post(p, {}));
  }
  off();
  assert.deepEqual(seen, []);
  assert.equal(isSessionPath('/auth/switch-workspace'), true);
  assert.equal(isSessionPath('/clients/1'), true);
});

test('once the session is marked lost, staff requests fail fast without the network', async () => {
  setSessionLost(true);
  for (let i = 0; i < 20; i++) {
    await assert.rejects(api.patch('/clients/1', { spaceBlocks: [] }), (e: unknown) => e instanceof ApiError && e.status === 401);
  }
  assert.equal(calls.length, 0);
  // Signing in still works.
  status = 200;
  await api.get('/auth/me');
  assert.equal(calls.length, 1);
});

test('a throwing listener never masks the error', async () => {
  const off = onUnauthorized(() => { throw new Error('boom'); });
  await assert.rejects(api.get('/bootstrap'), (e: unknown) => e instanceof ApiError && e.status === 401);
  off();
});
