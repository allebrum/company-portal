import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Field-level envelope encryption for stored secrets (project/client
 * credentials vault).
 *
 *   format:  v2.<kid>.<iv>.<ciphertext>.<tag>     (base64url parts)
 *   cipher:  AES-256-GCM, fresh random 96-bit IV per value, 128-bit tag
 *   key:     HKDF-SHA256(master[kid], salt, info="hoppa:credentials:<kid>")
 *   AAD:     "hoppa:v2|<kid>|<tenantId>|<rowId>|<field>"
 *
 * The AAD binds every ciphertext to the workspace, row and column it was
 * written for: copying an encrypted value onto another row, another field
 * or another tenant makes decryption fail (GCM tag mismatch) instead of
 * silently revealing it in the wrong place.
 *
 * Keys come from a keyset (env CREDENTIALS_KEYS = JSON {"<kid>":"<key>"})
 * plus CREDENTIALS_ACTIVE_KID. New values are always written with the active
 * kid; older kids stay in the keyset until `credentials:rotate` has re-encrypted
 * everything onto the active key. Each master key must be ≥ 32 random bytes,
 * given as 64 hex chars or base64/base64url.
 *
 * Nothing in this module logs or returns key material.
 */

export const ENC_VERSION = 'v2';
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const HKDF_SALT = Buffer.from('hoppa-credentials-hkdf-salt-v2', 'utf8');
const KID_RE = /^[A-Za-z0-9_-]{1,32}$/;

export interface Keyset {
  activeKid: string;
  /** kid → derived 32-byte AES key. */
  keys: ReadonlyMap<string, Buffer>;
}

export interface FieldContext {
  tenantId: string;
  rowId: string;
  field: string;
}

export class KeysetError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = 'KeysetError';
  }
}

function decodeMasterKey(raw: string): Buffer {
  const v = raw.trim();
  if (/^[0-9a-fA-F]{64,}$/.test(v) && v.length % 2 === 0) return Buffer.from(v, 'hex');
  if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(v)) return Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  throw new KeysetError('credentials_key_bad_encoding');
}

export function deriveKey(master: Buffer, kid: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, HKDF_SALT, Buffer.from(`hoppa:credentials:${kid}`, 'utf8'), 32));
}

/**
 * Parse + validate a keyset. Throws KeysetError (code only, never key bytes)
 * when anything is missing or malformed — callers treat that as "not
 * configured" and fail closed.
 */
export function parseKeyset(keysJson: string | undefined, activeKid: string | undefined): Keyset {
  if (!keysJson?.trim() || !activeKid?.trim()) throw new KeysetError('credentials_not_configured');
  let parsed: unknown;
  try {
    parsed = JSON.parse(keysJson);
  } catch {
    throw new KeysetError('credentials_keys_bad_json');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new KeysetError('credentials_keys_bad_json');
  const keys = new Map<string, Buffer>();
  for (const [kid, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!KID_RE.test(kid)) throw new KeysetError('credentials_bad_kid');
    if (typeof value !== 'string') throw new KeysetError('credentials_key_bad_encoding');
    const master = decodeMasterKey(value);
    if (master.length < 32) throw new KeysetError('credentials_key_too_short');
    keys.set(kid, deriveKey(master, kid));
  }
  const kid = activeKid.trim();
  if (!keys.has(kid)) throw new KeysetError('credentials_active_kid_missing');
  return { activeKid: kid, keys };
}

function aad(kid: string, ctx: FieldContext): Buffer {
  if (!ctx.tenantId || !ctx.rowId || !ctx.field) throw new Error('crypto_bad_context');
  return Buffer.from(`hoppa:${ENC_VERSION}|${kid}|${ctx.tenantId}|${ctx.rowId}|${ctx.field}`, 'utf8');
}

export function encryptField(plaintext: string, ctx: FieldContext, keyset: Keyset): string {
  const kid = keyset.activeKid;
  const key = keyset.keys.get(kid)!;
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  cipher.setAAD(aad(kid, ctx));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [ENC_VERSION, kid, iv.toString('base64url'), ct.toString('base64url'), tag.toString('base64url')].join('.');
}

/** The kid an encrypted value was written with (no decryption). */
export function kidOf(blob: string): string {
  const parts = blob.split('.');
  if (parts.length !== 5 || parts[0] !== ENC_VERSION || !KID_RE.test(parts[1] ?? '')) throw new Error('crypto_bad_format');
  return parts[1]!;
}

/** Throws on any tampering, wrong row/field/tenant, unknown kid or bad format. */
export function decryptField(blob: string, ctx: FieldContext, keyset: Keyset): string {
  const parts = blob.split('.');
  if (parts.length !== 5 || parts[0] !== ENC_VERSION) throw new Error('crypto_bad_format');
  const [, kid, ivB64, ctB64, tagB64] = parts as [string, string, string, string, string];
  const key = keyset.keys.get(kid);
  if (!key) throw new Error('crypto_unknown_kid');
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) throw new Error('crypto_bad_format');
  const decipher = createDecipheriv(ALGO, key, iv, { authTagLength: TAG_LEN });
  decipher.setAAD(aad(kid, ctx));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8');
}

/**
 * Re-encrypt onto the active key. Returns the new blob, or null when the
 * value is already on the active kid (nothing to do).
 */
export function rotateField(blob: string, ctx: FieldContext, keyset: Keyset): string | null {
  if (kidOf(blob) === keyset.activeKid) return null;
  return encryptField(decryptField(blob, ctx, keyset), ctx, keyset);
}
