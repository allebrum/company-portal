import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTotp, totpCode } from '../totp.js';

// RFC 6238 Appendix B test vectors (SHA-1, 8 digits, seed "12345678901234567890").
const SEED_B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('RFC 6238 SHA-1 vectors', () => {
  const p = parseTotp(`otpauth://totp/x?secret=${SEED_B32}&digits=8`);
  assert.equal(totpCode(p, 59_000).code, '94287082');
  assert.equal(totpCode(p, 1111111109_000).code, '07081804');
  assert.equal(totpCode(p, 1234567890_000).code, '89005924');
});

test('plain base32 seeds (incl. short 80-bit ones, spaces, lowercase) give 6-digit codes', () => {
  const { code, expiresInSec } = totpCode(parseTotp('jbsw y3dp ehpk 3pxp'));
  assert.match(code, /^\d{6}$/);
  assert.ok(expiresInSec >= 1 && expiresInSec <= 30);
});

test('rejects garbage', () => {
  assert.throws(() => parseTotp('not base32 !!'));
  assert.throws(() => parseTotp('otpauth://hotp/x?secret=JBSWY3DPEHPK3PXP'));
});
