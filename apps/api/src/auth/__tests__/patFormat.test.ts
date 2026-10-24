import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISPLAY_PREFIX_LEN, generateRawToken, hashToken, hashesEqual, looksLikeToken, TOKEN_PREFIX } from '../patFormat.js';

test('generated tokens are prefixed, 256-bit, unique, and well-formed', () => {
  const a = generateRawToken();
  const b = generateRawToken();
  assert.ok(a.startsWith(TOKEN_PREFIX));
  assert.equal(a.length, TOKEN_PREFIX.length + 43);
  assert.notEqual(a, b);
  assert.ok(looksLikeToken(a));
  assert.ok(DISPLAY_PREFIX_LEN < a.length - 32, 'display prefix reveals only a small part');
});

test('looksLikeToken rejects junk before any DB lookup', () => {
  for (const s of ['', 'hpat_', 'hpat_short', 'ghp_' + 'a'.repeat(43), 'hpat_' + 'a'.repeat(42) + '!', 'hpat_' + 'a'.repeat(44)]) {
    assert.equal(looksLikeToken(s), false, s);
  }
});

test('hashToken is a stable sha256 hex digest; hashesEqual compares safely', () => {
  const t = generateRawToken();
  const h = hashToken(t);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(hashToken(t), h);
  assert.ok(hashesEqual(h, hashToken(t)));
  assert.ok(!hashesEqual(h, hashToken(t + 'x')));
  assert.ok(!hashesEqual(h, 'abcd'));
});
