import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { redactSecrets, secretsReplacer } from '../redact.js';

// A user row exactly as `db.select().from(users)` returns it, plus the
// other credential-bearing rows. None of these values may ever leave the API.
const fullUser = {
  id: 'u1',
  name: 'Ada',
  email: 'ada@example.com',
  passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$SALT$HASH',
  googleSub: '1234567890',
  authProvider: 'password',
  initials: 'AD',
  color: '#000',
  billable: '150',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const totpRow = { userId: 'u1', secret: 'JBSWY3DPEHPK3PXP', enabled: true };
const passkeyRow = { id: 'p1', userId: 'u1', credentialId: 'cred', publicKey: 'pk-bytes', counter: 7, name: 'Laptop' };
const authTokenRow = { id: 't1', userId: 'u1', kind: 'reset', tokenHash: 'sha256', expiresAt: 'x' };
const recoveryRow = { id: 'r1', userId: 'u1', codeHash: 'sha256' };
const oauthRow = { userId: 'u1', provider: 'google_drive', accessToken: 'ya29', refreshToken: '1//r' };
const websiteRow = { id: 'w1', credentialUsernameEnc: 'enc', credentialPasswordEnc: 'enc', hasCredentialPassword: true };

const SECRET_VALUES = ['$argon2id', 'JBSWY3DPEHPK3PXP', 'pk-bytes', 'sha256', 'ya29', '1//r', 'enc"'];

function assertNoSecrets(json: string) {
  for (const key of ['googleSub', 'passwordHash', 'password_hash', 'tokenHash', 'codeHash', 'accessToken', 'refreshToken', 'credentialPasswordEnc', 'credentialUsernameEnc', '"secret"', 'publicKey']) {
    assert.ok(!json.includes(key), `response contains ${key}: ${json}`);
  }
  for (const v of SECRET_VALUES) assert.ok(!json.includes(v), `response contains secret value ${v}`);
}

const payload = {
  me: { ...fullUser, permissions: ['x'] },
  users: [fullUser, { ...fullUser, id: 'u2' }],
  nested: { deeper: [{ row: fullUser }] },
  totp: totpRow,
  passkeys: [passkeyRow],
  tokens: [authTokenRow, recoveryRow],
  oauth: oauthRow,
  websites: [websiteRow],
};

test('secretsReplacer strips every secret key at any depth', () => {
  assertNoSecrets(JSON.stringify(payload, secretsReplacer));
});

test('secretsReplacer keeps the ordinary fields', () => {
  const out = JSON.parse(JSON.stringify(payload, secretsReplacer));
  assert.deepEqual(Object.keys(out.users[0]).sort(), Object.keys(fullUser).filter((k) => k !== 'passwordHash' && k !== 'googleSub').sort());
  assert.equal(out.me.permissions[0], 'x');
  assert.deepEqual(out.totp, { userId: 'u1', enabled: true });
  assert.deepEqual(out.passkeys[0], { id: 'p1', userId: 'u1', credentialId: 'cred', name: 'Laptop' });
  assert.equal(out.websites[0].hasCredentialPassword, true);
});

test('generic words like "secret" survive outside credential rows', () => {
  const content = { blocks: [{ content: 'secret plan', secret: 'not a credential', counter: 3, publicKey: 'shown' }] };
  assert.deepEqual(JSON.parse(JSON.stringify(content, secretsReplacer)), content);
});

test('redactSecrets (socket payloads) strips the same keys without mutating input', () => {
  const before = JSON.stringify(payload);
  const out = redactSecrets(payload);
  assertNoSecrets(JSON.stringify(out));
  assert.equal(JSON.stringify(payload), before, 'input must not be mutated');
  assert.equal(redactSecrets(null), null);
  assert.equal(redactSecrets('passwordHash'), 'passwordHash');
});

test('redactSecrets tolerates cycles', () => {
  const a: Record<string, unknown> = { passwordHash: 'h', name: 'n' };
  a.self = a;
  const out = redactSecrets(a) as Record<string, unknown>;
  assert.equal(out.passwordHash, undefined);
  assert.equal(out.name, 'n');
});

test('redactSecrets redacts an object every time it is shared (not cyclic)', () => {
  const out = redactSecrets({ a: fullUser, b: [fullUser], c: { d: fullUser } });
  assertNoSecrets(JSON.stringify(out));
});

test('an express app with the json replacer never returns secrets, even for raw rows', async () => {
  const app = express();
  app.set('json replacer', secretsReplacer);
  app.get('/raw-user', (_req, res) => res.json(fullUser));
  app.get('/raw-list', (_req, res) => res.json([fullUser]));
  app.get('/bootstrap-like', (_req, res) => res.json(payload));
  app.patch('/users/u1', (_req, res) => res.json({ ...fullUser, reused: false }));
  const server = app.listen(0);
  try {
    const { port } = server.address() as AddressInfo;
    for (const [method, path] of [['GET', '/raw-user'], ['GET', '/raw-list'], ['GET', '/bootstrap-like'], ['PATCH', '/users/u1']] as const) {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { method });
      assert.equal(r.status, 200);
      const body = await r.text();
      assertNoSecrets(body);
      assert.ok(body.includes('ada@example.com'));
    }
  } finally {
    server.close();
  }
});

test('the backstop stays wired into res.json and every socket emit', async () => {
  const { readFile } = await import('node:fs/promises');
  const here = new URL('.', import.meta.url);
  const index = await readFile(new URL('../../index.ts', here), 'utf8');
  assert.match(index, /app\.set\('json replacer', secretsReplacer\)/);
  const emitSrc = await readFile(new URL('../../realtime/emit.ts', here), 'utf8');
  const emits = emitSrc.match(/\.emit\([^;]*\);/g) ?? [];
  assert.ok(emits.length >= 7, 'expected the emit helpers');
  for (const e of emits) assert.match(e, /safe\(payload\)/, `unfiltered socket emit: ${e}`);
});
