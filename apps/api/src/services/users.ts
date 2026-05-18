import { eq, sql, asc } from 'drizzle-orm';
import argon2 from 'argon2';
import { db } from '../db/client.js';
import { users, type User } from '../db/schema.js';
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
  const password = args.password ?? 'Allebrum2026!';
  const passwordHash = await argon2.hash(password);
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
  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) return null;
  if (user.status === 'invited') {
    await db.update(users).set({ status: 'active' }).where(eq(users.id, user.id));
  }
  return user;
}
