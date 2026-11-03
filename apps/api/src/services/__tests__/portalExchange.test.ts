import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTokenRow, exchangePortalToken, type PortalExchangeDeps, type InspectedToken } from '../portalExchange.js';

type Opts = {
  token?: InspectedToken;
  contact?: { id: string; clientId: string } | null;
  client?: { id: string; slug: string | null; publishedAt: string | null } | null;
  consumeOk?: boolean;
};

function deps(o: Opts = {}) {
  const calls = { consume: 0 };
  const d: PortalExchangeDeps = {
    inspect: async () => o.token ?? { state: 'valid', contactId: 'ct1' },
    loadContact: async () => (o.contact === undefined ? { id: 'ct1', clientId: 'cl1' } : o.contact),
    loadClient: async () =>
      o.client === undefined ? { id: 'cl1', slug: 'acme', publishedAt: '2026-01-01T00:00:00Z' } : o.client,
    consume: async () => {
      calls.consume++;
      return o.consumeOk ?? true;
    },
  };
  return { d, calls };
}

const run = (o: Opts, slug = 'acme') => {
  const { d, calls } = deps(o);
  return exchangePortalToken({ slug, token: 'raw' }, d).then((r) => ({ r, calls }));
};

test('happy path consumes exactly once and returns session data', async () => {
  const { r, calls } = await run({}, 'ACME ');
  assert.deepEqual(r, { ok: true, contactId: 'ct1', clientId: 'cl1', slug: 'acme' });
  assert.equal(calls.consume, 1);
});

test('unknown token → invalid_token, nothing consumed', async () => {
  const { r, calls } = await run({ token: { state: 'not_found' } });
  assert.deepEqual(r, { ok: false, error: 'invalid_token' });
  assert.equal(calls.consume, 0);
});

test('expired → token_expired, nothing consumed', async () => {
  const { r, calls } = await run({ token: { state: 'expired', contactId: 'ct1' } });
  assert.deepEqual(r, { ok: false, error: 'token_expired' });
  assert.equal(calls.consume, 0);
});

test('used → token_used', async () => {
  const { r, calls } = await run({ token: { state: 'used', contactId: 'ct1' } });
  assert.deepEqual(r, { ok: false, error: 'token_used' });
  assert.equal(calls.consume, 0);
});

test('unpublished portal → portal_unpublished and the token survives', async () => {
  const { r, calls } = await run({ client: { id: 'cl1', slug: 'acme', publishedAt: null } });
  assert.deepEqual(r, { ok: false, error: 'portal_unpublished' });
  assert.equal(calls.consume, 0);
});

test('slug mismatch → invalid_token (no cross-client info), not consumed', async () => {
  const { r, calls } = await run({}, 'other-client');
  assert.deepEqual(r, { ok: false, error: 'invalid_token' });
  assert.equal(calls.consume, 0);
});

test('slug mismatch wins over expired/used so other clients learn nothing', async () => {
  for (const state of ['expired', 'used'] as const) {
    const { r } = await run({ token: { state, contactId: 'ct1' } }, 'other-client');
    assert.deepEqual(r, { ok: false, error: 'invalid_token' });
  }
});

test('missing contact or client → invalid_token', async () => {
  assert.deepEqual((await run({ contact: null })).r, { ok: false, error: 'invalid_token' });
  assert.deepEqual((await run({ client: null })).r, { ok: false, error: 'invalid_token' });
  assert.deepEqual((await run({ token: { state: 'valid', contactId: null } })).r, { ok: false, error: 'invalid_token' });
});

test('lost race on atomic claim → token_used', async () => {
  const { r, calls } = await run({ consumeOk: false });
  assert.deepEqual(r, { ok: false, error: 'token_used' });
  assert.equal(calls.consume, 1);
});

test('classifyTokenRow', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');
  assert.equal(classifyTokenRow(null, now), 'not_found');
  assert.equal(classifyTokenRow({ usedAt: '2026-05-01T00:00:00Z', expiresAt: '2027-01-01T00:00:00Z' }, now), 'used');
  assert.equal(classifyTokenRow({ usedAt: null, expiresAt: '2026-05-31T00:00:00Z' }, now), 'expired');
  assert.equal(classifyTokenRow({ usedAt: null, expiresAt: '2026-06-02T00:00:00Z' }, now), 'valid');
  // used beats expired: a link consumed long ago reports "used"
  assert.equal(classifyTokenRow({ usedAt: '2026-01-01T00:00:00Z', expiresAt: '2026-02-01T00:00:00Z' }, now), 'used');
});
