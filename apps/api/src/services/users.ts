import { and, eq, sql, asc, count } from 'drizzle-orm';
import { db } from '../db/client.js';
import { users, userGroups, userPermissionOverrides, tenantMembers, type User } from '../db/schema.js';
import { HttpError } from '../middleware/errorHandler.js';
import { appendActivity } from './activity.js';
import { emit } from '../realtime/emit.js';
import { EV } from '@modernzen/shared';
import { env } from '../env.js';
import { getServiceSupabase } from '../lib/supabase.js';
import { currentTenantId } from '../tenancy/context.js';
import { tenantEq } from '../tenancy/scope.js';
import { ensureMembership, getTenant, isMember } from './tenants.js';

function initialsFrom(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!)
    .join('')
    .toUpperCase();
}

/**
 * List the users of the CURRENT workspace. `users` is a global identity table
 * (one row per email, no `tenant_id`); membership is row-level via
 * `tenant_members`. So every tenant-facing listing MUST inner-join membership
 * and filter to the active tenant — otherwise one org sees every other org's
 * people. This one function backs `GET /users`, the bootstrap `users` array,
 * the Gmail "system sender" dropdown, and the CSV export, so scoping it here
 * closes all of those at once. Runs inside a request tenant context.
 */
export async function listUsers(): Promise<User[]> {
  const rows = await db
    .select()
    .from(users)
    .innerJoin(tenantMembers, eq(tenantMembers.userId, users.id))
    .where(tenantEq(tenantMembers.tenantId))
    .orderBy(asc(users.name));
  return rows.map((r) => r.users);
}

export async function getUser(id: string): Promise<User | undefined> {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0];
}

export async function findByEmail(email: string): Promise<User | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  return rows[0];
}

export async function inviteUser(args: {
  name: string;
  email: string;
  billable?: number;
  color?: string;
  whoId: string;
  /** When true (default), issue an invite token + email an accept link.
   *  Pass false for Google-only teammates who'll sign in via OAuth. */
  sendInvite?: boolean;
}): Promise<{ user: User; reused: boolean }> {
  const inviteTenantId = currentTenantId();

  // `users` is a global identity. If this email already exists, it may belong
  // to ANOTHER workspace — that's the cross-org invite case (supported): we add
  // a membership here so the person can switch into this workspace. Only reject
  // if they're already a member of THIS workspace.
  const existing = await findByEmail(args.email);
  if (existing && (await isMember(existing.id, inviteTenantId))) {
    throw new HttpError(409, 'already_member');
  }

  // Modern Zen: seat enforcement. The workspace's seat limit lives on the tenant
  // row (tenant.seatLimit). Null = unlimited (the flat-price custom-billing
  // model doesn't meter seats by default, and self-host is always unlimited).
  // Adding EITHER a brand-new or an existing-from-another-org user consumes a
  // seat here, so this check guards both branches below.
  const tenant = await getTenant(inviteTenantId);
  const seatLimit = tenant?.seatLimit ?? null;
  if (seatLimit != null) {
    const [memberCount] = await db
      .select({ n: count() })
      .from(tenantMembers)
      .where(eq(tenantMembers.tenantId, inviteTenantId));
    if (Number(memberCount?.n ?? 0) >= seatLimit) {
      throw new HttpError(402, 'seat_limit_reached');
    }
  }

  // Cross-org invite: reuse the existing global identity — just grant
  // membership in this workspace. They keep their existing credentials, so we
  // send NO set-password invite; they'll see the new workspace in the switcher
  // on their next load (and any group assignment happens via setUserGroups in
  // the caller, scoped to this tenant).
  if (existing) {
    await ensureMembership(inviteTenantId, existing.id);
    emit.toOrg(EV.USER_CREATED, { id: existing.id, by: args.whoId, at: new Date().toISOString() });
    await appendActivity({
      whoId: args.whoId,
      kind: 'user.invite',
      target: `${existing.email} added to workspace`,
    });
    return { user: existing, reused: true };
  }

  // Brand-new identity. The Supabase auth user must exist first (the profile
  // `users.id` FK references `auth.users.id`). `inviteUserByEmail` creates the
  // auth user AND sends the Supabase invite email (a magic link to set a
  // password); `sendInvite: false` (Google-only / SSO teammates) just creates
  // the auth user with no email. We mirror the identity into the `users`
  // profile keyed to the returned auth uid.
  const supa = getServiceSupabase().auth.admin;
  const created =
    args.sendInvite !== false
      ? await supa.inviteUserByEmail(args.email, {
          data: { name: args.name },
          redirectTo: `${env.WEB_ORIGIN}/accept-invite`,
        })
      : await supa.createUser({ email: args.email, email_confirm: true, user_metadata: { name: args.name } });
  if (created.error || !created.data.user) {
    throw new HttpError(502, 'invite_failed');
  }
  const authId = created.data.user.id;

  const [row] = await db
    .insert(users)
    .values({
      id: authId,
      name: args.name,
      email: args.email,
      initials: initialsFrom(args.name),
      color: args.color ?? '#6b7280',
      billable: String(args.billable ?? 150),
      status: 'invited',
    })
    .returning();
  if (!row) throw new Error('user insert failed');
  // Enroll the invited user in the inviting admin's workspace so they can
  // resolve a tenant at login. The profile row is global (one identity across
  // workspaces); membership is per-tenant.
  await ensureMembership(inviteTenantId, row.id);
  emit.toOrg(EV.USER_CREATED, { id: row.id, by: args.whoId, at: new Date().toISOString() });
  await appendActivity({ whoId: args.whoId, kind: 'user.invite', target: `${row.email} invited` });
  return { user: row, reused: false };
}

/** Re-send the Supabase invite email for an `invited` user. */
export async function resendInvite(userId: string, whoId: string): Promise<void> {
  const target = await getUser(userId);
  if (!target) throw new HttpError(404, 'user_not_found');
  if (target.status !== 'invited') throw new HttpError(400, 'user_already_active');
  const { error } = await getServiceSupabase().auth.admin.inviteUserByEmail(target.email, {
    redirectTo: `${env.WEB_ORIGIN}/accept-invite`,
  });
  if (error) throw new HttpError(502, 'invite_resend_failed');
  await appendActivity({ whoId, kind: 'user.invite.resend', target: target.email });
}

export async function updateUser(
  id: string,
  patch: Partial<{
    name: string;
    email: string;
    billable: number;
    color: string;
    initials: string;
    password: string;
  }>,
  whoId: string,
): Promise<User> {
  const upd: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) {
    upd.name = patch.name;
    if (patch.initials === undefined) upd.initials = initialsFrom(patch.name);
  }
  if (patch.email !== undefined) upd.email = patch.email;
  if (patch.billable !== undefined) upd.billable = String(patch.billable);
  if (patch.color !== undefined) upd.color = patch.color;
  if (patch.initials !== undefined) upd.initials = patch.initials;
  // Passwords live in Supabase Auth, not the profile table.
  if (patch.password !== undefined) {
    const { error } = await getServiceSupabase().auth.admin.updateUserById(id, { password: patch.password });
    if (error) throw new HttpError(502, 'password_update_failed');
  }
  const [row] = await db.update(users).set(upd).where(eq(users.id, id)).returning();
  if (!row) throw new HttpError(404, 'user_not_found');
  emit.toOrg(EV.USER_UPDATED, { id: row.id, by: whoId, at: new Date().toISOString() });
  return row;
}

/**
 * Remove a user from the CURRENT workspace. `users` is a global identity, so a
 * naive `DELETE FROM users` would wipe the person out of EVERY workspace they
 * belong to (and let a cross-tenant admin destroy another org's account). So:
 *  - the target must be a member of the active tenant (else 404 — this also
 *    blocks cross-tenant deletes), and
 *  - we drop only THIS workspace's membership + group/permission assignments.
 *  - the global identity row is deleted only when this was their LAST
 *    workspace (FK cascades then clean their per-tenant data everywhere).
 */
export async function deleteUser(id: string, whoId: string): Promise<void> {
  const tenantId = currentTenantId();
  const memberships = await db
    .select({ tenantId: tenantMembers.tenantId })
    .from(tenantMembers)
    .where(eq(tenantMembers.userId, id));
  if (!memberships.some((m) => m.tenantId === tenantId)) {
    throw new HttpError(404, 'user_not_found');
  }

  // Drop the active workspace's bindings only — other workspaces are untouched.
  await db.delete(userGroups).where(and(eq(userGroups.userId, id), tenantEq(userGroups.tenantId)));
  await db
    .delete(userPermissionOverrides)
    .where(and(eq(userPermissionOverrides.userId, id), tenantEq(userPermissionOverrides.tenantId)));
  await db.delete(tenantMembers).where(and(eq(tenantMembers.userId, id), tenantEq(tenantMembers.tenantId)));

  let name: string | null = null;
  if (memberships.length <= 1) {
    // Last workspace — remove the global identity (cascades clean the rest).
    const [row] = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id, name: users.name });
    name = row?.name ?? null;
  } else {
    name = (await getUser(id))?.name ?? null;
  }
  // emit.toOrg is scoped to the active tenant's realtime room, so only this
  // workspace hears the removal.
  emit.toOrg(EV.USER_DELETED, { id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'user.remove', target: `${name ?? id} removed` });
}

// Password verification + Google identity resolution moved to Supabase Auth.
// Sign-in (password / OAuth) happens client-side via supabase.auth; the API
// trusts the resulting JWT (see auth/supabaseAuth.ts). New Google users are
// provisioned into the default workspace by the post-sign-in bootstrap, not here.
