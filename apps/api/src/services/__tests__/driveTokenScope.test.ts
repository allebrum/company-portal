import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryBuilder } from 'drizzle-orm/pg-core';
import { oauthTokens } from '../../db/schema.js';
import { withTenant } from '../../tenancy/context.js';
import { driveTokenScope, DRIVE_PROVIDER } from '../driveTokenScope.js';

// Regression guard for the Google Drive multi-tenant isolation fix.
//
// Builds the exact WHERE clause services/drive.ts uses to resolve a workspace's
// Drive credential and inspects the generated SQL (no DB needed). If anyone
// drops the tenant scoping, the active tenant id stops being bound into the
// query and these assertions fail.

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const driveTokenSql = (tenantId: string) =>
  withTenant(tenantId, () =>
    new QueryBuilder().select().from(oauthTokens).where(driveTokenScope()).toSQL(),
  );

test('Drive credential lookup is scoped to the provider AND the active workspace', () => {
  const { sql, params } = driveTokenSql(TENANT_A);
  assert.match(sql, /tenant_id/, 'query filters on tenant_id');
  assert.match(sql, /provider/, 'query filters on provider');
  assert.ok(params.includes(DRIVE_PROVIDER), 'provider value is bound');
  assert.ok(params.includes(TENANT_A), 'the active tenant id is bound into the query');
});

test('switching tenant context binds the new workspace and never leaks the other', () => {
  const a = driveTokenSql(TENANT_A);
  const b = driveTokenSql(TENANT_B);
  assert.ok(a.params.includes(TENANT_A) && !a.params.includes(TENANT_B), 'A resolves only A');
  assert.ok(b.params.includes(TENANT_B) && !b.params.includes(TENANT_A), 'B resolves only B');
});
