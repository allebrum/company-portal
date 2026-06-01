import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { tenants, tenantMembers, type Tenant } from '../db/schema.js';

/**
 * Hoppa multi-tenancy — tenant/workspace lookups.
 *
 * Phase 1 surface: resolve which workspace(s) a user belongs to and pick the
 * active one on login. Provisioning (creating new tenants from the marketing
 * webhook) + the per-tenant defaults seeder land in Phase 2/3.
 */

export type TenantSummary = { id: string; name: string; slug: string; isOwner: boolean };

/** The oldest tenant — the default workspace seeded by migration 0016. */
export async function getDefaultTenantId(): Promise<string | null> {
  const [row] = await db.select({ id: tenants.id }).from(tenants).orderBy(asc(tenants.createdAt)).limit(1);
  return row?.id ?? null;
}

/** Workspaces this user is a member of, for the switcher + login resolution. */
export async function getUserTenants(userId: string): Promise<TenantSummary[]> {
  const rows = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      isOwner: tenantMembers.isOwner,
    })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(eq(tenantMembers.userId, userId))
    .orderBy(asc(tenants.createdAt));
  return rows;
}

/** True if the user is a member of the given tenant (used to gate switching). */
export async function isMember(userId: string, tenantId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.tenantId, tenantId)))
    .limit(1);
  return !!row;
}

/**
 * Pick the tenant to activate at login. Phase 1: users belong to exactly the
 * default workspace, so this returns that one. When a user belongs to >1
 * workspace (Phase 2+), the caller surfaces a picker instead of auto-picking.
 */
export async function resolveLoginTenantId(userId: string): Promise<string | null> {
  const list = await getUserTenants(userId);
  if (list.length === 0) return null;
  return list[0]!.id;
}

export async function getTenant(id: string): Promise<Tenant | undefined> {
  const [row] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return row;
}

/**
 * Ensure a user is enrolled in a tenant. Idempotent — used by db:init to put
 * the break-glass admin into the default workspace, and later by invite
 * acceptance / provisioning.
 */
export async function ensureMembership(tenantId: string, userId: string, isOwner = false): Promise<void> {
  await db
    .insert(tenantMembers)
    .values({ tenantId, userId, isOwner })
    .onConflictDoNothing();
}
