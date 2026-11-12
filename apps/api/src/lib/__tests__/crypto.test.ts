import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { decryptField, encryptField, KeysetError, kidOf, parseKeyset, rotateField } from '../crypto.js';

const K1 = randomBytes(32).toString('base64');
const K2 = randomBytes(32).toString('hex');
const T_A = '11111111-1111-1111-1111-111111111111';
const T_B = '22222222-2222-2222-2222-222222222222';
const ROW_1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROW_2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ks1 = parseKeyset(JSON.stringify({ k1: K1 }), 'k1');
const ksBoth = parseKeyset(JSON.stringify({ k1: K1, k2: K2 }), 'k2');
const ctx = { tenantId: T_A, rowId: ROW_1, field: 'secret' };

test('round-trips and produces the v2.<kid>.<iv>.<ct>.<tag> format', () => {
  const blob = encryptField('hunter2 root pw', ctx, ks1);
  const parts = blob.split('.');
  assert.equal(parts.length, 5);
  assert.equal(parts[0], 'v2');
  assert.equal(parts[1], 'k1');
  assert.equal(kidOf(blob), 'k1');
  assert.ok(!blob.includes('hunter2'));
  assert.equal(decryptField(blob, ctx, ks1), 'hunter2 root pw');
});

test('a fresh IV per encryption (same plaintext → different ciphertext)', () => {
  assert.notEqual(encryptField('same', ctx, ks1), encryptField('same', ctx, ks1));
});

test('AAD binding: moving a ciphertext to another row, field or tenant fails', () => {
  const blob = encryptField('s3cret', ctx, ks1);
  assert.throws(() => decryptField(blob, { ...ctx, rowId: ROW_2 }, ks1));
  assert.throws(() => decryptField(blob, { ...ctx, field: 'notes' }, ks1));
  assert.throws(() => decryptField(blob, { ...ctx, tenantId: T_B }, ks1));
});

test('tampering with any part fails the GCM tag check', () => {
  const blob = encryptField('s3cret', ctx, ks1);
  const [v, kid, iv, ct, tag] = blob.split('.') as [string, string, string, string, string];
  const flip = (s: string) => {
    const b = Buffer.from(s, 'base64url');
    b[0] = b[0]! ^ 0x01;
    return b.toString('base64url');
  };
  assert.throws(() => decryptField([v, kid, iv, flip(ct), tag].join('.'), ctx, ks1));
  assert.throws(() => decryptField([v, kid, iv, ct, flip(tag)].join('.'), ctx, ks1));
  assert.throws(() => decryptField([v, kid, flip(iv), ct, tag].join('.'), ctx, ks1));
  // relabelling the kid changes the AAD/key → fails even if the key exists
  const both = encryptField('x', ctx, ksBoth); // k2
  assert.throws(() => decryptField(both.replace('.k2.', '.k1.'), ctx, ksBoth));
});

test('unknown kid / wrong key / bad format fail closed', () => {
  const blob = encryptField('s3cret', ctx, ksBoth); // k2
  assert.throws(() => decryptField(blob, ctx, ks1), /crypto_unknown_kid/);
  const other = parseKeyset(JSON.stringify({ k1: randomBytes(32).toString('base64') }), 'k1');
  assert.throws(() => decryptField(encryptField('s', ctx, ks1), ctx, other));
  assert.throws(() => decryptField('v1.abc.def.ghi', ctx, ks1), /crypto_bad_format/);
});

test('rotation: old-kid values re-encrypt onto the active kid; active values are left alone', () => {
  const old = encryptField('rotate me', ctx, ks1); // k1
  const rotated = rotateField(old, ctx, ksBoth);
  assert.ok(rotated);
  assert.equal(kidOf(rotated!), 'k2');
  assert.equal(decryptField(rotated!, ctx, ksBoth), 'rotate me');
  assert.equal(rotateField(rotated!, ctx, ksBoth), null);
  // once the old kid is removed, the rotated value still decrypts…
  const onlyK2 = parseKeyset(JSON.stringify({ k2: K2 }), 'k2');
  assert.equal(decryptField(rotated!, ctx, onlyK2), 'rotate me');
  // …and an un-rotated one doesn't.
  assert.throws(() => decryptField(old, ctx, onlyK2));
  // rotation keeps the AAD binding
  assert.throws(() => decryptField(rotated!, { ...ctx, rowId: ROW_2 }, ksBoth));
});

test('keyset validation fails closed with codes only (never key material)', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      assert.ok(e instanceof KeysetError);
      assert.ok(!e.message.includes(K1));
      return e.code;
    }
    return 'no error';
  };
  assert.equal(code(() => parseKeyset(undefined, 'k1')), 'credentials_not_configured');
  assert.equal(code(() => parseKeyset('', 'k1')), 'credentials_not_configured');
  assert.equal(code(() => parseKeyset('{not json', 'k1')), 'credentials_keys_bad_json');
  assert.equal(code(() => parseKeyset(JSON.stringify({ k1: K1 }), 'k9')), 'credentials_active_kid_missing');
  assert.equal(code(() => parseKeyset(JSON.stringify({ k1: randomBytes(16).toString('base64') }), 'k1')), 'credentials_key_too_short');
  assert.equal(code(() => parseKeyset(JSON.stringify({ 'bad kid!': K1 }), 'bad kid!')), 'credentials_bad_kid');
  assert.equal(code(() => parseKeyset(JSON.stringify([K1]), 'k1')), 'credentials_keys_bad_json');
});

test('plain kid:key format: single, multiple, whitespace, default active kid', () => {
  const single = parseKeyset(`  k1:${K1}  `, undefined);
  assert.equal(single.activeKid, 'k1');
  assert.equal(decryptField(encryptField('plain single', ctx, single), ctx, ks1), 'plain single');

  // trailing / empty entries ignored; spaces around kids, keys, and commas
  const both = parseKeyset(` k1: ${K1} , , k2: ${K2} ,`, 'k2');
  assert.equal(both.activeKid, 'k2');
  const blob = encryptField('plain both', ctx, both);
  assert.equal(kidOf(blob), 'k2');
  assert.equal(decryptField(blob, ctx, ksBoth), 'plain both');

  // JSON still works and is interchangeable with the plain format
  const fromJson = parseKeyset(JSON.stringify({ k1: K1 }), 'k1');
  assert.equal(decryptField(encryptField('json', ctx, fromJson), ctx, single), 'json');
});

test('plain keyset validation: duplicate kid, bad kid, missing active with multiple keys', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      assert.ok(e instanceof KeysetError);
      assert.ok(!e.message.includes(K1));
      assert.ok(!e.message.includes(K2));
      return e.code;
    }
    return 'no error';
  };
  assert.equal(code(() => parseKeyset(`k1:${K1},k1:${K2}`, 'k1')), 'credentials_bad_kid');
  assert.equal(code(() => parseKeyset(`bad kid!:${K1}`, 'k1')), 'credentials_bad_kid');
  assert.equal(code(() => parseKeyset(`k1:${K1},k2:${K2}`, undefined)), 'credentials_active_kid_missing');
  assert.equal(code(() => parseKeyset(`k1:${K1},k2:${K2}`, '  ')), 'credentials_active_kid_missing');
  assert.equal(code(() => parseKeyset(`k1:${K1},k2:${K2}`, 'k9')), 'credentials_active_kid_missing');
  // one key and no / blank active kid defaults to that key
  assert.equal(parseKeyset(`k1:${K1}`, undefined).activeKid, 'k1');
  assert.equal(parseKeyset(`k1:${K1}`, '  ').activeKid, 'k1');
  assert.equal(parseKeyset(JSON.stringify({ k1: K1 }), undefined).activeKid, 'k1');
});
