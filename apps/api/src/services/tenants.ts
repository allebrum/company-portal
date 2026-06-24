import { randomUUID } from 'node:crypto';
import { eq, and, asc, sql } from 'drizzle-orm';
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
import { SYSTEM_GROUPS, SYSTEM_GROUP_PERMISSIONS } from '@modernzen/shared';
import { getServiceSupabase } from '../lib/supabase.js';

/**
 * A drizzle executor — the base `db` or a transaction handle. Lets the
 * provisioning helpers run inside `provisionAccount`'s advisory-locked
 * transaction so a concurrent same-email signup can't create a duplicate
 * tenant/customer.
 */
type Executor = Pick<typeof db, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

/**
 * Modern Zen multi-tenancy — tenant/workspace lookups.
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

export async function getTenant(id: string, ex: Executor = db): Promise<Tenant | undefined> {
  const [row] = await ex.select().from(tenants).where(eq(tenants.id, id)).limit(1);
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
export async function findOwnedBillingTenant(userId: string, ex: Executor = db): Promise<Tenant | undefined> {
  const owned = await ex
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .innerJoin(tenants, eq(tenants.id, tenantMembers.tenantId))
    .where(and(eq(tenantMembers.userId, userId), eq(tenantMembers.isOwner, true)))
    .orderBy(asc(tenants.createdAt));
  for (const o of owned) {
    const t = await getTenant(o.tenantId, ex);
    if (t?.billingExternalId) return t;
  }
  return undefined;
}

/**
 * Ensure a user is enrolled in a tenant. Idempotent — used by db:init to put
 * the break-glass admin into the default workspace, and later by invite
 * acceptance / provisioning.
 */
export async function ensureMembership(
  tenantId: string,
  userId: string,
  isOwner = false,
  ex: Executor = db,
): Promise<void> {
  await ex
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
export async function seedTenantDefaults(tenantId: string, ex: Executor = db): Promise<Record<string, string>> {
  const groupIdByName: Record<string, string> = {};
  for (const gname of SYSTEM_GROUPS) {
    const existing = await ex
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.tenantId, tenantId), eq(groups.name, gname)))
      .limit(1);
    let gid = existing[0]?.id;
    if (!gid) {
      gid = randomUUID();
      await ex.insert(groups).values({
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
      await ex
        .insert(groupPermissions)
        .values(perms.map((perm) => ({ groupId: gid!, permissionKey: perm, tenantId })))
        .onConflictDoNothing();
    }
  }

  await ex.insert(appSettings).values({ tenantId }).onConflictDoNothing();
  await ex.insert(payConfig).values({ tenantId }).onConflictDoNothing();
  return groupIdByName;
}

/**
 * Provision a brand-new workspace + its owner. Phase 3's marketing-site
 * webhook calls this on `checkout.session.completed`. The owner user is a
 * global identity (looked up by email; created if new) and is added to the
 * tenant's Owner group + tenant_members. Returns the new tenant id + the
 * (possibly newly-created) owner user id.
 */
export async function provisionTenant(
  args: {
    name: string;
    slug: string;
    ownerEmail: string;
    ownerName: string;
    billingExternalId?: string | null;
    plan?: string | null;
    seatLimit?: number | null;
  },
  ex: Executor = db,
): Promise<{ tenantId: string; ownerUserId: string; created: boolean }> {
  const email = args.ownerEmail.trim().toLowerCase();
  const [tenant] = await ex
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

  const groupIds = await seedTenantDefaults(tenantId, ex);

  // Owner identity is global — reuse if the email already exists.
  const existing = await ex
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  let ownerUserId: string;
  let created = false;
  if (existing[0]) {
    ownerUserId = existing[0].id;
  } else {
    // The profile id FKs auth.users — create the Supabase auth identity first.
    const supaUser = await getServiceSupabase().auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { name: args.ownerName || email },
    });
    if (supaUser.error || !supaUser.data.user) throw new Error('owner auth user creation failed');
    const [u] = await ex
      .insert(users)
      .values({
        id: supaUser.data.user.id,
        name: args.ownerName || email,
        email,
        initials: email.slice(0, 2).toUpperCase(),
        status: 'invited',
      })
      .returning({ id: users.id });
    ownerUserId = u!.id;
    created = true;
  }

  await ex
    .insert(userGroups)
    .values({ userId: ownerUserId, groupId: groupIds.Owner!, tenantId })
    .onConflictDoNothing();
  await ensureMembership(tenantId, ownerUserId, true, ex);

  return { tenantId, ownerUserId, created };
}

/**
 * Race-free account provisioning for the marketing billing service. Billing
 * lives in the marketing service now: it creates the Stripe customer, then calls
 * this (over the HMAC provisioning contract) to create the IDENTITY. A per-email
 * Postgres advisory lock makes a duplicate tenant impossible; the loser resumes.
 *
 * This sets the owner's password (argon2, on a brand-new / not-yet-credentialed
 * owner only — never overwrites an existing one), records the Stripe customer id
 * (`billingExternalId`, passed in), and marks the workspace `trialing` so the row
 * is never left null (the gate is well-defined the instant it exists; trialing +
 * no-card is blocked anyway). The marketing service owns the trial DATES — it
 * stamps `trial_ends_at`/`next_bill_at` afterward.
 *
 * Returns the workspace to attach billing to, or `account_exists` when the email
 * already belongs to a real credentialed account (the caller tells them to sign
 * in). On `resumed` it returns the EXISTING tenant's `billingExternalId` so the
 * marketing side can detach the spare customer it just created.
 */
export type ProvisionAccountResult =
  | { kind: 'created' | 'resumed'; tenantId: string; ownerUserId: string; billingExternalId: string }
  | { kind: 'account_exists' };

export async function provisionAccount(args: {
  email: string;
  ownerName: string;
  workspaceName: string;
  slug: string;
  /** Plaintext password — set on the Supabase auth user for a brand-new /
   *  not-yet-credentialed owner only. */
  password: string;
  /** Stripe customer id, created by the marketing service before this call. */
  billingExternalId: string;
}): Promise<ProvisionAccountResult> {
  const email = args.email.trim().toLowerCase();
  return db.transaction(async (tx) => {
    // Serialize all signups for this email (xact-scoped; released on commit).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'signup:' + email}))`);

    const [existingUser] = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    if (existingUser) {
      // Retry / resume: reuse an already-owned billing workspace + its customer.
      const owned = await findOwnedBillingTenant(existingUser.id, tx);
      if (owned?.billingExternalId) {
        return { kind: 'resumed', tenantId: owned.id, ownerUserId: existingUser.id, billingExternalId: owned.billingExternalId };
      }
      // A real prior account → don't silently attach a new paid workspace.
      if (existingUser.status === 'active') {
        return { kind: 'account_exists' };
      }
      // else (invited / passwordless, no billing) → fall through and provision.
    }

    const prov = await provisionTenant(
      {
        name: args.workspaceName,
        slug: args.slug,
        ownerEmail: email,
        ownerName: args.ownerName,
        billingExternalId: args.billingExternalId,
      },
      tx,
    );

    // Set the owner's password on the Supabase auth user (the credential
    // authority) for a brand-new / not-yet-active owner only, and flip the
    // profile to active.
    const [owner] = await tx.select().from(users).where(eq(users.id, prov.ownerUserId)).limit(1);
    if (owner && owner.status !== 'active') {
      await getServiceSupabase().auth.admin.updateUserById(prov.ownerUserId, { password: args.password });
      await tx
        .update(users)
        .set({ status: 'active', updatedAt: new Date().toISOString() })
        .where(eq(users.id, prov.ownerUserId));
    }

    // Mark trialing immediately so the row is never null (gate-safe). The
    // marketing service stamps the trial dates; trialing + no card is blocked.
    await tx
      .update(tenants)
      .set({ billingStatus: 'trialing', failedAttempts: 0, lastPaymentError: null, updatedAt: new Date().toISOString() })
      .where(eq(tenants.id, prov.tenantId));

    return { kind: 'created', tenantId: prov.tenantId, ownerUserId: prov.ownerUserId, billingExternalId: args.billingExternalId };
  });
}
