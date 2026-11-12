import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { SYSTEM_GROUP_PERMISSIONS, OWNER_ONLY_PERMISSIONS } from '@allebrum/shared';
import { CREDENTIAL_META_COLUMNS, resolveCredentialAccess } from '../credentials.js';
import { groupChangeIsSensitive, overrideChangeIsSensitive } from '../rbacGuard.js';
import { rotateRow, type RotateStats } from '../../scripts/rotateCredentials.js';
import { encryptField, kidOf, parseKeyset } from '../../lib/crypto.js';

const perms = (g: keyof typeof SYSTEM_GROUP_PERMISSIONS) => new Set<string>(SYSTEM_GROUP_PERMISSIONS[g]);
const on = { configured: true };

test('starter groups: only Owner holds the credentials permissions', () => {
  for (const p of OWNER_ONLY_PERMISSIONS) {
    assert.ok(SYSTEM_GROUP_PERMISSIONS.Owner.includes(p), `Owner should have ${p}`);
    assert.ok(!SYSTEM_GROUP_PERMISSIONS.Admin.includes(p), `Admin must not have ${p}`);
    assert.ok(!SYSTEM_GROUP_PERMISSIONS.Member.includes(p), `Member must not have ${p}`);
    assert.ok(!SYSTEM_GROUP_PERMISSIONS.Bookkeeper.includes(p), `Bookkeeper must not have ${p}`);
  }
});

test('Owner can view, reveal, manage and manage access on every client', () => {
  const a = resolveCredentialAccess(perms('Owner'), null, on);
  assert.deepEqual(a, { configured: true, canView: true, canReveal: true, canManage: true, canManageAccess: true, viaAllowlist: false });
});

test('Admin, Member and Bookkeeper are denied without an allowlist entry', () => {
  for (const g of ['Admin', 'Member', 'Bookkeeper'] as const) {
    const a = resolveCredentialAccess(perms(g), null, on);
    assert.equal(a.canView, false, g);
    assert.equal(a.canReveal, false, g);
    assert.equal(a.canManage, false, g);
    assert.equal(a.canManageAccess, false, g);
  }
});

test('an allowlisted user can view + reveal that client, and manage only with canManage', () => {
  const viewer = resolveCredentialAccess(perms('Member'), { canManage: false }, on);
  assert.equal(viewer.canView, true);
  assert.equal(viewer.canReveal, true);
  assert.equal(viewer.canManage, false);
  assert.equal(viewer.canManageAccess, false); // never edits the allowlist itself
  assert.equal(viewer.viaAllowlist, true);
  const manager = resolveCredentialAccess(perms('Admin'), { canManage: true }, on);
  assert.equal(manager.canManage, true);
  assert.equal(manager.canManageAccess, false);
});

test('tokens: full alone grants nothing; explicit scopes are still capped by role + allowlist', () => {
  // accessFor passes only the explicitly-held credentials scopes (full is filtered out).
  const ownerFullOnly = resolveCredentialAccess(perms('Owner'), null, { ...on, tokenScopes: [] });
  assert.equal(ownerFullOnly.canView, false);
  assert.equal(ownerFullOnly.canReveal, false);
  assert.equal(ownerFullOnly.canManage, false);

  const ownerRead = resolveCredentialAccess(perms('Owner'), null, { ...on, tokenScopes: ['credentials:read'] });
  assert.equal(ownerRead.canReveal, true);
  assert.equal(ownerRead.canManage, false);
  assert.equal(ownerRead.canManageAccess, false);

  const ownerWrite = resolveCredentialAccess(perms('Owner'), null, { ...on, tokenScopes: ['credentials:write'] });
  assert.equal(ownerWrite.canReveal, false);
  assert.equal(ownerWrite.canManage, true);

  // An Admin's token with both scopes still can't see a client they're not allowlisted on.
  const adminBoth = resolveCredentialAccess(perms('Admin'), null, { ...on, tokenScopes: ['credentials:read', 'credentials:write'] });
  assert.equal(adminBoth.canView, false);
  assert.equal(adminBoth.canReveal, false);
  const adminAllowed = resolveCredentialAccess(perms('Admin'), { canManage: false }, { ...on, tokenScopes: ['credentials:read'] });
  assert.equal(adminAllowed.canReveal, true);
});

test('configured flag is passed through (UI shows "not configured")', () => {
  assert.equal(resolveCredentialAccess(perms('Owner'), null, { configured: false }).configured, false);
});

test('list queries never select an encrypted column', () => {
  for (const k of Object.keys(CREDENTIAL_META_COLUMNS)) {
    assert.ok(!/enc$/i.test(k), `list selects ${k}`);
  }
  assert.ok('hasSecret' in CREDENTIAL_META_COLUMNS);
});

test('rbac guard: joining/leaving a group with Owner-only perms is a sensitive change', () => {
  const byGroup = new Map<string, string[]>([
    ['owner', [...SYSTEM_GROUP_PERMISSIONS.Owner]],
    ['admin', [...SYSTEM_GROUP_PERMISSIONS.Admin]],
    ['member', [...SYSTEM_GROUP_PERMISSIONS.Member]],
  ]);
  assert.equal(groupChangeIsSensitive(['admin'], ['admin', 'owner'], byGroup), true);
  assert.equal(groupChangeIsSensitive(['owner'], [], byGroup), true);
  assert.equal(groupChangeIsSensitive(['member'], ['member', 'admin'], byGroup), false);
  assert.equal(groupChangeIsSensitive(['owner', 'member'], ['owner'], byGroup), false);
});

test('rbac guard: granting/denying a credentials override is a sensitive change; re-saving it is not', () => {
  const existing = [{ permission: 'credentials.reveal', effect: 'grant' }];
  assert.equal(overrideChangeIsSensitive([], existing), true);
  assert.equal(overrideChangeIsSensitive(existing, []), true);
  assert.equal(overrideChangeIsSensitive(existing, [...existing, { permission: 'forms.view', effect: 'grant' }]), false);
  assert.equal(overrideChangeIsSensitive([], [{ permission: 'forms.view', effect: 'grant' }]), false);
  assert.equal(overrideChangeIsSensitive([], [{ permission: 'groups.manage', effect: 'grant' }]), true);
});

test('rotation script step re-encrypts old-kid fields and counts without exposing values', () => {
  const k1 = randomBytes(32).toString('base64');
  const k2 = randomBytes(32).toString('base64');
  const old = parseKeyset(JSON.stringify({ k1 }), 'k1');
  const both = parseKeyset(JSON.stringify({ k1, k2 }), 'k2');
  const row = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenantId: '11111111-1111-1111-1111-111111111111' };
  const r = {
    ...row,
    secretEnc: encryptField('pw', { ...row, rowId: row.id, field: 'secret' }, old),
    notesEnc: encryptField('n', { ...row, rowId: row.id, field: 'notes' }, both),
    totpEnc: null,
  };
  const stats: RotateStats = { rows: 0, values: 0, rotated: 0, alreadyActive: 0, failed: 0, byKid: {} };
  const patch = rotateRow(r, both, stats);
  assert.ok(patch?.secretEnc);
  assert.equal(kidOf(patch!.secretEnc!), 'k2');
  assert.equal(patch!.notesEnc, undefined);
  assert.deepEqual({ ...stats, byKid: undefined }, { rows: 0, values: 2, rotated: 1, alreadyActive: 1, failed: 0, byKid: undefined });
  // a value moved from another row fails (AAD) and is counted, not rotated
  const moved = { ...r, id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
  const s2: RotateStats = { rows: 0, values: 0, rotated: 0, alreadyActive: 0, failed: 0, byKid: {} };
  rotateRow(moved, both, s2);
  assert.equal(s2.failed, 1);
});
