import { and, eq, sql, asc, count } from 'drizzle-orm';
import argon2 from 'argon2';
import { db } from '../db/client.js';
import { users, groups, userGroups, tenantMembers, type User } from '../db/schema.js';
import { HttpError } from '../middleware/errorHandler.js';
import { appendActivity } from './activity.js';
import { emit } from '../realtime/emit.js';
import { EV } from '@allebrum/shared';
import { env } from '../env.js';
import { issueToken, invalidateTokensFor, INVITE_TTL_MS } from '../auth/tokens.js';
import { sendInviteEmail } from './mail.js';
import { currentTenantId } from '../tenancy/context.js';
import { ensureMembership, getDefaultTenantId, getTenant } from './tenants.js';

function initialsFrom(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!)
    .join('')
    .toUpperCase();
}

export async function listUsers(): Promise<User[]> {
  return db.select().from(users).orderBy(asc(users.name));
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
}): Promise<User> {
  // We never accept a password on invite anymore — the invitee sets their
  // own via the accept-invite page after consuming an invite token. The
  // column stays nullable; if `sendInvite` is false (Google-only), it
  // stays null forever and password login is correctly disabled.
  const existing = await findByEmail(args.email);
  if (existing) throw new HttpError(409, 'email_taken');

  // Hoppa: seat enforcement. The workspace's seat limit lives on the tenant
  // row (tenant.seatLimit). Null = unlimited (the flat-price custom-billing
  // model doesn't meter seats by default, and self-host is always unlimited).
  // Otherwise reject once the active member count would exceed it.
  const inviteTenantId = currentTenantId();
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

  const [row] = await db
    .insert(users)
    .values({
      name: args.name,
      email: args.email,
      passwordHash: null,
      initials: initialsFrom(args.name),
      color: args.color ?? '#6b7280',
      billable: String(args.billable ?? 150),
      status: 'invited',
    })
    .returning();
  if (!row) throw new Error('user insert failed');
  // Hoppa: enroll the invited user in the inviting admin's workspace so they
  // can resolve a tenant at login. The user row itself is global (one
  // identity across workspaces); membership is per-tenant.
  await ensureMembership(currentTenantId(), row.id);
  emit.toOrg(EV.USER_CREATED, { id: row.id, by: args.whoId, at: new Date().toISOString() });
  await appendActivity({
    whoId: args.whoId,
    kind: 'user.invite',
    target: `${row.email} invited`,
  });

  // Issue a 7-day invite token and send the accept-invite email from the
  // inviter's connected Gmail. Errors here are logged but don't fail the
  // invite — the user row is already created and the admin can resend
  // once they've connected Gmail (otherwise the URL hits the log).
  if (args.sendInvite !== false) {
    try {
      const inviter = await getUser(args.whoId);
      const { rawToken, expiresAt } = await issueToken({ kind: 'user', userId: row.id }, 'invite', INVITE_TTL_MS);
      const acceptUrl = `${env.WEB_ORIGIN}/accept-invite?token=${encodeURIComponent(rawToken)}`;
      await sendInviteEmail({
        senderUserId: args.whoId,
        to: row.email,
        inviterName: inviter?.name ?? 'A teammate',
        acceptUrl,
        expiresAt,
      });
    } catch (e) {
      console.error('[invite] failed to send email', e);
    }
  }
  return row;
}

/** Re-issue an invite token for an `invited` user — invalidates any prior
 *  unused invite tokens so older email links stop working immediately.
 *  The new email is sent from whoever clicks Resend (their Gmail). */
export async function resendInvite(userId: string, whoId: string): Promise<void> {
  const target = await getUser(userId);
  if (!target) throw new HttpError(404, 'user_not_found');
  if (target.status !== 'invited') throw new HttpError(400, 'user_already_active');
  await invalidateTokensFor(target.id, 'invite');
  const inviter = await getUser(whoId);
  const { rawToken, expiresAt } = await issueToken({ kind: 'user', userId: target.id }, 'invite', INVITE_TTL_MS);
  const acceptUrl = `${env.WEB_ORIGIN}/accept-invite?token=${encodeURIComponent(rawToken)}`;
  await sendInviteEmail({
    senderUserId: whoId,
    to: target.email,
    inviterName: inviter?.name ?? 'A teammate',
    acceptUrl,
    expiresAt,
  });
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
  if (patch.password !== undefined) upd.passwordHash = await argon2.hash(patch.password);
  const [row] = await db.update(users).set(upd).where(eq(users.id, id)).returning();
  if (!row) throw new HttpError(404, 'user_not_found');
  emit.toOrg(EV.USER_UPDATED, { id: row.id, by: whoId, at: new Date().toISOString() });
  return row;
}

export async function deleteUser(id: string, whoId: string): Promise<void> {
  const [row] = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id, name: users.name });
  if (!row) throw new HttpError(404, 'user_not_found');
  emit.toOrg(EV.USER_DELETED, { id: row.id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'user.remove', target: `${row.name} removed` });
}

export async function verifyLogin(email: string, password: string): Promise<User | null> {
  const user = await findByEmail(email);
  if (!user) return null;
  if (!user.passwordHash) return null; // Google-only account: no password login
  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) return null;
  if (user.status === 'invited') {
    await db.update(users).set({ status: 'active' }).where(eq(users.id, user.id));
  }
  return user;
}

export async function findByGoogleSub(sub: string): Promise<User | undefined> {
  const rows = await db.select().from(users).where(eq(users.googleSub, sub)).limit(1);
  return rows[0];
}

/**
 * Resolve a Google identity to a local user: match by google_sub, else link
 * by verified email, else create a new account (no password, member-less —
 * an admin assigns groups afterward).
 */
export async function findOrCreateGoogleUser(profile: {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}): Promise<User> {
  const bySub = await findByGoogleSub(profile.sub);
  if (bySub) return bySub;

  const byEmail = await findByEmail(profile.email);
  if (byEmail) {
    const [linked] = await db
      .update(users)
      .set({ googleSub: profile.sub, status: 'active', updatedAt: new Date().toISOString() })
      .where(eq(users.id, byEmail.id))
      .returning();
    return linked ?? byEmail;
  }

  const initials = (profile.name || profile.email)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!)
    .join('')
    .toUpperCase();
  const [created] = await db
    .insert(users)
    .values({
      name: profile.name || profile.email,
      email: profile.email,
      passwordHash: null,
      googleSub: profile.sub,
      authProvider: 'google',
      initials,
      color: '#6b7280',
      billable: '150',
      status: 'active',
    })
    .returning();
  if (!created) throw new Error('google user creation failed');

  // New domain-restricted Google sign-ups land in the default workspace with
  // its Member group so they get a working app immediately. This runs in the
  // OAuth callback (no request tenant context), so the default tenant is
  // resolved explicitly. The caller (auth.ts) also enrolls them in
  // tenant_members.
  const defaultTenantId = await getDefaultTenantId();
  if (defaultTenantId) {
    const [memberGroup] = await db
      .select({ id: groups.id })
      .from(groups)
      .where(and(eq(groups.name, 'Member'), eq(groups.tenantId, defaultTenantId)))
      .limit(1);
    if (memberGroup) {
      await db
        .insert(userGroups)
        .values({ userId: created.id, groupId: memberGroup.id, tenantId: defaultTenantId })
        .onConflictDoNothing();
    }
  }
  return created;
}
