import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signManageRef, verifyManageRef } from '../manageRef.js';

// Requires SESSION_SECRET (set in the CI test env + .env.example). env.ts parses
// process.env at import, so process.env.SESSION_SECRET is the same value
// manageRef signs with — used below to forge an expired-but-correctly-signed ref.

test('sign/verify roundtrip binds tenant + user', () => {
  const ref = signManageRef('tenant-1', 'user-9');
  assert.deepEqual(verifyManageRef(ref), { tenantId: 'tenant-1', userId: 'user-9' });
});

test('a tampered signature is rejected', () => {
  const ref = signManageRef('tenant-1', 'user-9');
  const tampered = ref.slice(0, -2) + (ref.endsWith('aa') ? 'bb' : 'aa');
  assert.equal(verifyManageRef(tampered), null);
});

test('a forged payload with a stale signature is rejected', () => {
  const ref = signManageRef('tenant-1', 'user-9');
  const sig = ref.slice(ref.lastIndexOf('.'));
  const forged = Buffer.from(`tenant-2.user-9.${Date.now() + 60_000}`).toString('base64url');
  assert.equal(verifyManageRef(forged + sig), null);
});

test('malformed input returns null', () => {
  assert.equal(verifyManageRef(''), null);
  assert.equal(verifyManageRef('garbage'), null);
  assert.equal(verifyManageRef('a.b'), null);
});

test('an expired ref is rejected even with a valid signature', () => {
  const secret = process.env.SESSION_SECRET!;
  const payload = `t.u.${Date.now() - 1_000}`; // expired 1s ago
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  const expired = `${Buffer.from(payload).toString('base64url')}.${sig}`;
  assert.equal(verifyManageRef(expired), null);
});
