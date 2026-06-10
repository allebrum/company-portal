import { and, eq } from 'drizzle-orm';
import { oauthTokens } from '../db/schema.js';
import { tenantEq } from '../tenancy/scope.js';

/** Canonical provider key for the workspace Google Drive (+ Docs/Sheets) credential. */
export const DRIVE_PROVIDER = 'google_drive';

/**
 * WHERE clause that scopes a Google Drive credential to the ACTIVE workspace.
 *
 * Extracted from drive.ts so the multi-tenant isolation guarantee is unit
 * testable without a database (see __tests__/driveTokenScope.test.ts). EVERY
 * Drive-token read/delete must AND this in — without the `tenantEq`, a
 * workspace would resolve whichever Google account was connected last across
 * the whole instance (cross-tenant data exposure). Must be called inside a
 * tenant context (a tenant-scoped request or `withTenant`).
 */
export function driveTokenScope() {
  return and(eq(oauthTokens.provider, DRIVE_PROVIDER), tenantEq(oauthTokens.tenantId));
}
