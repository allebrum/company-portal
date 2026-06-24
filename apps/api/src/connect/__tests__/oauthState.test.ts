import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signState, verifyState } from '../oauthState.js';

// CSRF / cross-client-linking guard for the provider OAuth round-trip.
// Requires PORTAL_SESSION_SECRET (CI sets a dummy; locally from .env).

test('signs and verifies OAuth state', () => {
  const token = signState({ clientId: 'client-1', provider: 'zernio', ref: 'linkedin' });
  assert.deepEqual(verifyState(token), { clientId: 'client-1', provider: 'zernio', ref: 'linkedin' });
});

test('rejects a tampered client id', () => {
  const token = signState({ clientId: 'client-1', provider: 'zernio', ref: 'linkedin' });
  const sig = token.slice(token.lastIndexOf('.') + 1);
  const forged =
    Buffer.from(
      'oauth-state:' +
        JSON.stringify({ clientId: 'OTHER', provider: 'zernio', ref: 'linkedin', nonce: 'x', exp: Date.now() + 60_000 }),
    ).toString('base64url') +
    '.' +
    sig;
  assert.equal(verifyState(forged), null);
});

test('rejects empty / malformed state', () => {
  assert.equal(verifyState(undefined), null);
  assert.equal(verifyState('garbage'), null);
});
