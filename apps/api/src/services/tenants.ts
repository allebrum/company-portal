import { randomUUID } from 'node:crypto';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  tenants,
  tenantMembers,
  groups,
  groupPermissions,
  userGroups,
  appSettings,
  payConfig,
  users,
  type Tenant,
} from '../db/schema.js';
import { SYSTEM_GROUPS, SYSTEM_GROUP_PERMISSIONS } from '@allebrum/shared';

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
 * The owner user of a tenant (the member flagged `is_owner`). Used by the
 * marketing-signup `/complete` step to mint the auto-login handoff token for
 * the right user. Oldest membership wins if (defensively) there's more than one.
 */
export async function getOwnerUserId(tenantId: string): Promise<string | null> {
  const [row] = await db
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, tenantId), eq(tenantMembers.isOwner, true)))
    .orderBy(asc(tenantMembers.createdAt))
    .limit(1);
  return row?.userId ?? null;
}

/**
 * Find an existing billing workspace this user OWNS (has a Stripe customer id).
 * Lets `/billing/signup` be idempotent on retry: a double-submit reuses the
 * already-provisioned tenant + customer instead of creating duplicates. Returns
 * the oldest such tenant, or undefined if the user owns no billing workspace.
 */
export async function findOwnedBillingTenant(userId: string): Promise<Tenant | undefined> {
  const owned = await db
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.isOwner, true)))
    .orderBy(asc(tenants.createdAt));
  for (const o of owned) {
    const t = await getTenant(o.tenantId);
    if (t?.billingExternalId) return t;
  }
  return undefined;
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

/**
 * Seed a freshly-created workspace with the per-tenant defaults the app needs
 * to be usable: the four system groups + their permissions, an app_settings
 * row, and a pay_config row. Idempotent — safe to re-run. Returns a map of
 * system-group name → id so the caller can attach the owner.
 *
 * Mirrors the group/settings bootstrap in db/init.ts, but stamped for a
 * specific tenant (db/init seeds the DEFAULT workspace; this seeds any new
 * one provisioned from the marketing site in Phase 3).
 */
export async function seedTenantDefaults(tenantId: string): Promise<Record<string, string>> {
  const groupIdByName: Record<string, string> = {};
  for (const gname of SYSTEM_GROUPS) {
    const existing = await db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.tenantId, tenantId), eq(groups.name, gname)))
      .limit(1);
    let gid = existing[0]?.id;
    if (!gid) {
      gid = randomUUID();
      await db.insert(groups).values({
        id: gid,
        tenantId,
        name: gname,
        description: `${gname} (system group)`,
        isSystem: true,
        require2fa: false,
      });
    }
    groupIdByName[gname] = gid;
    const perms = SYSTEM_GROUP_PERMISSIONS[gname];
    if (perms.length > 0) {
      await db
        .insert(groupPermissions)
        .values(perms.map((perm) => ({ groupId: gid!, permissionKey: perm, tenantId })))
        .onConflictDoNothing();
    }
  }

  await db.insert(appSettings).values({ tenantId }).onConflictDoNothing();
  await db.insert(payConfig).values({ tenantId }).onConflictDoNothing();
  return groupIdByName;
}

/**
 * Provision a brand-new workspace + its owner. Phase 3's marketing-site
 * webhook calls this on `checkout.session.completed`. The owner user is a
 * global identity (looked up by email; created if new) and is added to the
 * tenant's Owner group + tenant_members. Returns the new tenant id + the
 * (possibly newly-created) owner user id.
 */
export async function provisionTenant(args: {
  name: string;
  slug: string;
  ownerEmail: string;
  ownerName: string;
  billingExternalId?: string | null;
  plan?: string | null;
  seatLimit?: number | null;
}): Promise<{ tenantId: string; ownerUserId: string; created: boolean }> {
  const email = args.ownerEmail.trim().toLowerCase();
  const [tenant] = await db
    .insert(tenants)
    .values({
      name: args.name,
      slug: args.slug,
      billingExternalId: args.billingExternalId ?? null,
      plan: args.plan ?? null,
      seatLimit: args.seatLimit ?? null,
      status: 'active',
    })
    .returning({ id: tenants.id });
  const tenantId = tenant!.id;

  const groupIds = await seedTenantDefaults(tenantId);

  // Owner identity is global — reuse if the email already exists.
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  let ownerUserId: string;
  let created = false;
  if (existing[0]) {
    ownerUserId = existing[0].id;
  } else {
    const [u] = await db
      .insert(users)
      .values({
        name: args.ownerName || email,
        email,
        passwordHash: null,
        initials: email.slice(0, 2).toUpperCase(),
        status: 'invited',
      })
      .returning({ id: users.id });
    ownerUserId = u!.id;
    created = true;
  }

  await db
    .insert(userGroups)
    .values({ userId: ownerUserId, groupId: groupIds.Owner!, tenantId })
    .onConflictDoNothing();
  await ensureMembership(tenantId, ownerUserId, true);

  return { tenantId, ownerUserId, created };
}
