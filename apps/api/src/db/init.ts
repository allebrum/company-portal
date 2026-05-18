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
import argon2 from 'argon2';
import { sql, eq } from 'drizzle-orm';
import { db, sqlClient } from './client.js';
import { users, groups, permissions, groupPermissions, userGroups, appSettings } from './schema.js';
import {
  PERMISSIONS,
  PERMISSION_LABELS,
  PERMISSION_CATEGORIES,
  SYSTEM_GROUPS,
  SYSTEM_GROUP_PERMISSIONS,
} from '@allebrum/shared';
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
  const allowedDomains = (env.ALLOWED_EMAIL_DOMAINS ?? 'allebrum.com')
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  // 1. Permission catalog — insert missing, then refresh labels/category so
  //    the catalog always matches @allebrum/shared.
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
        .values(perms.map((perm) => ({ groupId: gid!, permissionKey: perm })))
        .onConflictDoNothing();
    }
  }

  // 3. App-settings singleton — create only if missing (preserves any
  //    admin-customised settings on later deploys).
  await db
    .insert(appSettings)
    .values({ id: 'singleton', allowedEmailDomains: allowedDomains })
    .onConflictDoNothing();

  // 4. Break-glass admin — only if that email does not already exist.
  const existingAdmin = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${adminEmail}`)
    .limit(1);
  let adminCreated = false;
  if (!existingAdmin[0]) {
    const id = randomUUID();
    const passwordHash = await argon2.hash(adminPassword);
    await db.insert(users).values({
      id,
      name: 'Administrator',
      email: adminEmail,
      passwordHash,
      initials: adminEmail.slice(0, 2).toUpperCase(),
      status: 'active',
    });
    await db
      .insert(userGroups)
      .values({ userId: id, groupId: groupIdByName.Owner! })
      .onConflictDoNothing();
    adminCreated = true;
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
