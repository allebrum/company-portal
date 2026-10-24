import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryBuilder } from 'drizzle-orm/pg-core';
import { users, type User } from '../../db/schema.js';
import { PUBLIC_USER_COLUMNS, PUBLIC_USER_KEYS, toPublicUser } from '../publicUser.js';

const PRIVATE = ['passwordHash', 'googleSub'];

const row: User = {
  id: 'u1',
  name: 'Ada',
  email: 'ada@example.com',
  passwordHash: '$argon2id$v=19$hash',
  googleSub: 'g-123',
  authProvider: 'password',
  initials: 'AD',
  color: '#000',
  billable: '150',
  status: 'active',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

test('the public allowlist excludes the password hash and Google subject', () => {
  for (const k of PRIVATE) assert.ok(!(PUBLIC_USER_KEYS as string[]).includes(k), `${k} is public`);
});

test('every users column is either public or explicitly private (new columns must be classified)', () => {
  const all = Object.keys(users).filter((k) => !k.startsWith('_') && typeof (users as any)[k] === 'object' && (users as any)[k]?.name);
  const unclassified = all.filter((k) => !(PUBLIC_USER_KEYS as string[]).includes(k) && !PRIVATE.includes(k));
  assert.deepEqual(unclassified, [], 'classify new users columns in services/publicUser.ts and this test');
});

test('toPublicUser drops private fields from a full row', () => {
  const pub = toPublicUser(row) as Record<string, unknown>;
  for (const k of PRIVATE) assert.equal(k in pub, false);
  assert.equal(pub.email, 'ada@example.com');
  assert.ok(!JSON.stringify(pub).includes('argon2'));
});

test('the listUsers/updateUser column selection never reads password_hash from SQL', () => {
  const sql = new QueryBuilder().select(PUBLIC_USER_COLUMNS).from(users).toSQL().sql;
  assert.ok(!sql.includes('password_hash'), sql);
  assert.ok(!sql.includes('google_sub'), sql);
  assert.ok(sql.includes('"email"'));
});
