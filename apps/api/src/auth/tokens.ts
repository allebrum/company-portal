import { createHash, randomBytes } from 'node:crypto';
import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { authTokens } from '../db/schema.js';
import { HttpError } from '../middleware/errorHandler.js';

export type AuthTokenKind = 'invite' | 'reset';

/**
 * Generate a fresh single-use token of the given kind.
 *
 * The raw 32-byte secret is base64url-encoded and returned to the caller —
 * it goes straight into the outbound email and is **never** read back from
 * the database. The DB only ever holds the SHA-256 hash, so a stolen DB
 * dump cannot be used to impersonate anyone, and an attacker cannot guess
 * tokens by brute force.
 *
 * `expiresAt` is an absolute timestamp; clock skew on consume is checked
 * against the DB row's `expires_at`, not the JVM clock.
 */
export async function issueToken(
  userId: string,
  kind: AuthTokenKind,
  ttlMs: number,
): Promise<{ rawToken: string; expiresAt: Date }> {
  const rawToken = randomBytes(32).toString('base64url');
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + ttlMs);
  await db.insert(authTokens).values({
    userId,
    kind,
    tokenHash,
    expiresAt: expiresAt.toISOString(),
  });
  return { rawToken, expiresAt };
}

/**
 * Invalidate every still-valid token of the same kind for this user. Call
 * before issuing a new token (resend invite, "forgot password" again) so
 * older links stop working immediately.
 */
export async function invalidateTokensFor(userId: string, kind: AuthTokenKind): Promise<void> {
  await db
    .update(authTokens)
    .set({ usedAt: new Date().toISOString() })
    .where(and(
      eq(authTokens.userId, userId),
      eq(authTokens.kind, kind),
      isNull(authTokens.usedAt),
    ));
}

/**
 * Look the token up by hash, ensure it's the right kind, not expired, and
 * not already used. Atomically flips `used_at` so a second consume of the
 * same token errors out — that's the only thing standing between us and
 * replay attacks.
 *
 * Throws an HttpError(400, 'invalid_token') on every failure mode so we
 * don't leak which condition failed (expired vs already-used vs not found).
 */
export async function consumeToken(rawToken: string, kind: AuthTokenKind): Promise<{ userId: string }> {
  const tokenHash = sha256(rawToken);
  const now = new Date().toISOString();
  // Single-statement atomic claim: only mark used if it currently isn't.
  // The RETURNING gives us the userId iff the row was the right kind,
  // unexpired, and still unused.
  const claimed = await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(and(
      eq(authTokens.tokenHash, tokenHash),
      eq(authTokens.kind, kind),
      isNull(authTokens.usedAt),
    ))
    .returning({ userId: authTokens.userId, expiresAt: authTokens.expiresAt });
  const row = claimed[0];
  if (!row) throw new HttpError(400, 'invalid_token');
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    // The token was unused so the row got claimed; we've now used up an
    // expired one. That's fine — it can't be replayed.
    throw new HttpError(400, 'invalid_token');
  }
  return { userId: row.userId };
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days
export const RESET_TTL_MS = 60 * 60 * 1000;            // 1 hour
