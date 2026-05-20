import { eq, sql, asc } from 'drizzle-orm';
import argon2 from 'argon2';
import { db } from '../db/client.js';
import { users, groups, userGroups, type User } from '../db/schema.js';
import { HttpError } from '../middleware/errorHandler.js';
import { appendActivity } from './activity.js';
import { emit } from '../realtime/emit.js';
import { EV } from '@allebrum/shared';

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
  password?: string;
  billable?: number;
  color?: string;
  whoId: string;
}): Promise<User> {
  // No default password — leaving the field blank creates a Google-only
  // account (verifyLogin rejects null-passwordHash users, so password
  // login is correctly disabled and the only way in is Google sign-in).
  // The admin can still explicitly set a password for non-Google testers.
  const passwordHash = args.password ? await argon2.hash(args.password) : null;
  const existing = await findByEmail(args.email);
  if (existing) throw new HttpError(409, 'email_taken');
  const [row] = await db
    .insert(users)
    .values({
      name: args.name,
      email: args.email,
      passwordHash,
      initials: initialsFrom(args.name),
      color: args.color ?? '#6b7280',
      billable: String(args.billable ?? 150),
      status: 'invited',
    })
    .returning();
  if (!row) throw new Error('user insert failed');
  emit.toOrg(EV.USER_CREATED, { id: row.id, by: args.whoId, at: new Date().toISOString() });
  await appendActivity({
    whoId: args.whoId,
    kind: 'user.invite',
    target: `${row.email} invited`,
  });
  return row;
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

  // New domain-restricted Google sign-ups get the Member group so they land
  // on a working app immediately; an admin can elevate them afterward. (The
  // sub/email-link branches above intentionally preserve existing membership.)
  const [memberGroup] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.name, 'Member'))
    .limit(1);
  if (memberGroup) {
    await db
      .insert(userGroups)
      .values({ userId: created.id, groupId: memberGroup.id })
      .onConflictDoNothing();
  }
  return created;
}
