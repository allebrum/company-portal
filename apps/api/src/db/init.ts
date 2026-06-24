/**
 * Idempotent production bootstrap.
 *
 * Unlike `seed.ts` (a destructive dev fixture that TRUNCATEs everything and
 * loads demo data), this script is safe to run on every deploy: it only
 * ensures the permission catalog, system groups, the app-settings singleton,
 * and one break-glass admin exist. It never deletes data and never prints
 * the admin password.
 *
 * Run after `drizzle-kit migrate` (see the PRE_DEPLOY job in app.spec.yaml).
 */
import { randomUUID } from 'node:crypto';
import { sql, eq } from 'drizzle-orm';
import { db, sqlClient } from './client.js';
import { getServiceSupabase } from '../lib/supabase.js';
import { users, groups, permissions, groupPermissions, userGroups, appSettings, tenants, tenantMembers } from './schema.js';
import { asc } from 'drizzle-orm';
import {
  PERMISSIONS,
  PERMISSION_LABELS,
  PERMISSION_CATEGORIES,
  SYSTEM_GROUPS,
  SYSTEM_GROUP_PERMISSIONS,
} from '@modernzen/shared';
import { env } from '../env.js';

function categoryOf(perm: string): string {
  for (const [cat, perms] of Object.entries(PERMISSION_CATEGORIES)) {
    if ((perms as readonly string[]).includes(perm)) return cat;
  }
  return '';
}

async function main(): Promise<void> {
  const adminEmail = env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = env.ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    // eslint-disable-next-line no-console
    console.error('[init] ADMIN_EMAIL and ADMIN_PASSWORD must be set');
    process.exit(1);
  }
  // Default to no allow-list (empty = any email domain may sign in via Google).
  // Self-hosters set ALLOWED_EMAIL_DOMAINS to lock sign-up to their domain(s);
  // the SaaS/prod deploy sets it via its DO spec.
  const allowedDomains = (env.ALLOWED_EMAIL_DOMAINS ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  // 0. Hoppa: ensure the default workspace exists (migration 0016 creates it,
  //    but on any path where it's missing, create it). Everything init seeds
  //    is attached to this tenant so the bootstrap workspace is coherent.
  let defaultTenantId: string;
  {
    const [t] = await db.select({ id: tenants.id }).from(tenants).orderBy(asc(tenants.createdAt)).limit(1);
    if (t) {
      defaultTenantId = t.id;
    } else {
      const [created] = await db
        .insert(tenants)
        .values({ name: 'Modern Zen', slug: 'modern-zen', status: 'active' })
        .returning({ id: tenants.id });
      defaultTenantId = created!.id;
    }
  }

  // The default workspace (internal team in SaaS mode, the sole workspace when
  // self-hosting) is grandfathered out of subscription billing so it is never
  // 402'd once SaaS gating is enabled. Provisioned customer tenants stay
  // billing_exempt = false and resolve via the marketing subscription API.
  await db.update(tenants).set({ billingExempt: true }).where(eq(tenants.id, defaultTenantId));

  // 1. Permission catalog — insert missing, then refresh labels/category so
  //    the catalog always matches @modernzen/shared.
  await db
    .insert(permissions)
    .values(PERMISSIONS.map((p) => ({ key: p, label: PERMISSION_LABELS[p], category: categoryOf(p) })))
    .onConflictDoNothing();
  for (const p of PERMISSIONS) {
    await db
      .update(permissions)
      .set({ label: PERMISSION_LABELS[p], category: categoryOf(p) })
      .where(eq(permissions.key, p));
  }

  // 2. System groups + their permissions (create if missing; never drop).
  const groupIdByName: Record<string, string> = {};
  for (const gname of SYSTEM_GROUPS) {
    const existing = await db
      .select({ id: groups.id })
      .from(groups)
      .where(eq(groups.name, gname))
      .limit(1);
    let gid = existing[0]?.id;
    if (!gid) {
      gid = randomUUID();
      await db.insert(groups).values({
        id: gid,
        tenantId: defaultTenantId,
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
        .values(perms.map((perm) => ({ groupId: gid!, permissionKey: perm, tenantId: defaultTenantId })))
        .onConflictDoNothing();
    }
  }

  // 3. App-settings — one row per tenant (Phase 2 re-key dropped `id`).
  //    Create the default workspace's row only if missing (preserves any
  //    admin-customised settings on later deploys).
  await db
    .insert(appSettings)
    .values({ tenantId: defaultTenantId, allowedEmailDomains: allowedDomains, portalName: 'Modern Zen' })
    .onConflictDoNothing();

  // 4. Break-glass admin — only if that email does not already exist.
  const existingAdmin = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${adminEmail}`)
    .limit(1);
  let adminCreated = false;
  if (!existingAdmin[0]) {
    // Identity lives in Supabase Auth; reuse an existing auth user with this
    // email (prior partial run) or create one, then mirror the profile (FK).
    const admin = getServiceSupabase().auth.admin;
    const list = await admin.listUsers({ perPage: 1000 });
    let authId = list.data?.users.find((u) => u.email?.toLowerCase() === adminEmail)?.id;
    if (!authId) {
      const created = await admin.createUser({
        email: adminEmail,
        password: adminPassword,
        email_confirm: true,
        user_metadata: { name: 'Administrator' },
      });
      if (created.error || !created.data.user) {
        throw new Error(`[init] failed to create admin auth user: ${created.error?.message ?? 'unknown'}`);
      }
      authId = created.data.user.id;
    }
    await db.insert(users).values({
      id: authId,
      name: 'Administrator',
      email: adminEmail,
      initials: adminEmail.slice(0, 2).toUpperCase(),
      status: 'active',
    });
    await db
      .insert(userGroups)
      .values({ userId: authId, groupId: groupIdByName.Owner!, tenantId: defaultTenantId })
      .onConflictDoNothing();
    adminCreated = true;
  }

  // 5. Hoppa: ensure the admin is a member of the default workspace so login
  //    can resolve their tenant. Idempotent across re-runs.
  {
    const [admin] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${adminEmail}`)
      .limit(1);
    if (admin) {
      await db
        .insert(tenantMembers)
        .values({ tenantId: defaultTenantId, userId: admin.id, isOwner: true })
        .onConflictDoNothing();
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[init] done — permissions: ${PERMISSIONS.length}, groups: ${SYSTEM_GROUPS.length}, ` +
      `admin ${adminEmail} ${adminCreated ? 'created' : 'already present'}, ` +
      `allowed domains: ${allowedDomains.join(', ')}`,
  );
}

main()
  .then(async () => {
    await sqlClient.end();
    process.exit(0);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('[init] failed', err);
    await sqlClient.end().catch(() => undefined);
    process.exit(1);
  });
