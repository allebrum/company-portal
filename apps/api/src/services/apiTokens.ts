import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { apiTokens, users, type ApiToken } from '../db/schema.js';
import { HttpError } from '../middleware/errorHandler.js';
import { isMember } from './tenants.js';
import { DISPLAY_PREFIX_LEN, generateRawToken, hashToken, hashesEqual, looksLikeToken } from '../auth/patFormat.js';
import { FULL_ACCESS_SCOPE, type ApiTokenScope, type ApiTokenSummary, type CreatedApiToken, type CreateApiTokenInput } from '@allebrum/shared';

/**
 * Personal access tokens — create/list/revoke + bearer resolution. Token
 * format and hashing live in auth/patFormat.ts.
 */

/** Hard cap so a leaked session can't mint unbounded tokens. */
export const MAX_ACTIVE_TOKENS_PER_USER = 20;

export function toSummary(row: ApiToken): ApiTokenSummary {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes as ApiTokenScope[],
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
  };
}

export async function listTokens(userId: string, tenantId: string): Promise<ApiTokenSummary[]> {
  const rows = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), eq(apiTokens.tenantId, tenantId)))
    .orderBy(desc(apiTokens.createdAt));
  return rows.map(toSummary);
}

export async function createToken(
  userId: string,
  tenantId: string,
  input: CreateApiTokenInput,
): Promise<CreatedApiToken> {
  const [{ n } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(apiTokens)
    .where(
      and(
        eq(apiTokens.userId, userId),
        eq(apiTokens.tenantId, tenantId),
        isNull(apiTokens.revokedAt),
        sql`(${apiTokens.expiresAt} is null or ${apiTokens.expiresAt} > now())`,
      ),
    );
  if (n >= MAX_ACTIVE_TOKENS_PER_USER) throw new HttpError(400, 'too_many_tokens');

  const raw = generateRawToken();
  // `full` already implies everything; store it alone so the list reads cleanly.
  const scopes: string[] = input.scopes.includes(FULL_ACCESS_SCOPE)
    ? [FULL_ACCESS_SCOPE]
    : Array.from(new Set<string>(input.scopes));
  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
    : null;
  const [row] = await db
    .insert(apiTokens)
    .values({
      tenantId,
      userId,
      name: input.name,
      tokenHash: hashToken(raw),
      prefix: raw.slice(0, DISPLAY_PREFIX_LEN),
      scopes,
      expiresAt,
    })
    .returning();
  if (!row) throw new Error('api token insert failed');
  return { ...toSummary(row), token: raw };
}

export async function revokeToken(userId: string, tenantId: string, id: string): Promise<void> {
  const [row] = await db
    .update(apiTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(
      and(
        eq(apiTokens.id, id),
        eq(apiTokens.userId, userId),
        eq(apiTokens.tenantId, tenantId),
        isNull(apiTokens.revokedAt),
      ),
    )
    .returning({ id: apiTokens.id });
  if (!row) throw new HttpError(404, 'token_not_found');
}

export interface AuthenticatedToken {
  id: string;
  name: string;
  expiresAt: string | null;
  userId: string;
  tenantId: string;
  scopes: ApiTokenScope[];
  lastUsedAt: string | null;
}

/**
 * Resolve a raw bearer token to its owner. Returns null for unknown,
 * revoked, or expired tokens, and when the user is no longer active or no
 * longer a member of the token's workspace (removing someone from a
 * workspace implicitly kills their tokens there). Runs on EVERY request (no
 * caching), and the owner's permissions are loaded live by RBAC downstream,
 * so demoting the owner immediately demotes their tokens too.
 */
export async function authenticateToken(raw: string): Promise<AuthenticatedToken | null> {
  if (!looksLikeToken(raw)) return null;
  const h = hashToken(raw);
  const [row] = await db
    .select({ token: apiTokens, userStatus: users.status })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.tokenHash, h))
    .limit(1);
  if (!row || !hashesEqual(row.token.tokenHash, h)) return null;
  const t = row.token;
  if (t.revokedAt) return null;
  if (t.expiresAt && new Date(t.expiresAt).getTime() <= Date.now()) return null;
  if (row.userStatus !== 'active') return null;
  if (!(await isMember(t.userId, t.tenantId))) return null;
  return {
    id: t.id,
    name: t.name,
    expiresAt: t.expiresAt,
    userId: t.userId,
    tenantId: t.tenantId,
    scopes: t.scopes as ApiTokenScope[],
    lastUsedAt: t.lastUsedAt,
  };
}

/** Throttled to one write per token per minute. Best-effort. */
export async function touchToken(t: AuthenticatedToken): Promise<void> {
  if (t.lastUsedAt && Date.now() - new Date(t.lastUsedAt).getTime() < 60_000) return;
  try {
    await db.update(apiTokens).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiTokens.id, t.id));
  } catch {
    /* non-fatal */
  }
}
