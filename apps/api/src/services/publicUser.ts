import { users, type User } from '../db/schema.js';

/**
 * The ONLY user columns that may leave the server. An allowlist on purpose:
 * a new column on `users` (or a secret like `passwordHash` / `googleSub`)
 * stays private until someone deliberately adds it here. Every route that
 * returns a user goes through `PUBLIC_USER_COLUMNS` (SQL) or `toPublicUser`.
 */
export const PUBLIC_USER_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  authProvider: users.authProvider,
  initials: users.initials,
  color: users.color,
  billable: users.billable,
  status: users.status,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
} as const;

export type PublicUser = Pick<User, keyof typeof PUBLIC_USER_COLUMNS>;

export const PUBLIC_USER_KEYS = Object.keys(PUBLIC_USER_COLUMNS) as (keyof PublicUser)[];

/** Copy only the allowlisted fields of a user row. */
export function toPublicUser(u: User | PublicUser): PublicUser {
  const out = {} as Record<string, unknown>;
  for (const k of PUBLIC_USER_KEYS) out[k] = (u as Record<string, unknown>)[k];
  return out as PublicUser;
}
