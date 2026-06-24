import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signPortalSession, verifyPortalSession } from '../portalSession.js';

// Security guard for the stateless client-portal session token. Requires
// PORTAL_SESSION_SECRET in the environment (CI sets a dummy; locally it comes
// from .env).

test('signs and verifies a portal session roundtrip', () => {
  const s = { contactId: 'contact-1', clientId: 'client-1', slug: 'acme' };
  const token = signPortalSession(s);
  assert.deepEqual(verifyPortalSession(token), s);
});

test('rejects a tampered payload (re-pointed at another client) with the old signature', () => {
  const token = signPortalSession({ contactId: 'contact-1', clientId: 'client-1', slug: 'acme' });
  const sig = token.slice(token.lastIndexOf('.') + 1);
  const forgedPayload = Buffer.from(
    JSON.stringify({ contactId: 'contact-1', clientId: 'OTHER-CLIENT', slug: 'acme', exp: Date.now() + 60_000 }),
  ).toString('base64url');
  assert.equal(verifyPortalSession(`${forgedPayload}.${sig}`), null);
});

test('rejects empty / malformed tokens', () => {
  assert.equal(verifyPortalSession(undefined), null);
  assert.equal(verifyPortalSession(''), null);
  assert.equal(verifyPortalSession('not-a-token'), null);
  assert.equal(verifyPortalSession('a.b.c'), null);
});
