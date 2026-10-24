import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Personal access token format. `hpat_<43 base64url chars>` (32 random
 * bytes). Only sha256(token) is stored; the prefix column keeps the first
 * few characters so a user can tell their tokens apart in the list.
 */
export const TOKEN_PREFIX = 'hpat_';
export const DISPLAY_PREFIX_LEN = TOKEN_PREFIX.length + 6;

export function generateRawToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/** Cheap syntactic check before touching the DB. */
export function looksLikeToken(raw: string): boolean {
  return /^hpat_[A-Za-z0-9_-]{43}$/.test(raw);
}

/** Constant-time compare of two hex digests (defense in depth; lookup is by unique index). */
export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

