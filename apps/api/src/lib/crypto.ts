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
 * Keys come from a keyset (env CREDENTIALS_KEYS). Prefer the plain format
 * DigitalOcean's env editor accepts: `k1:<key>` or `k1:<key1>,k2:<key2>`.
 * JSON `{"<kid>":"<key>"}` is also accepted (detected when the value starts
 * with `{`). CREDENTIALS_ACTIVE_KID is the kid used for new writes; it can
 * be omitted when the keyset has exactly one key. Older kids stay in the
 * keyset until `credentials:rotate` has re-encrypted everything onto the
 * active key. Each master key must be ≥ 32 random bytes, given as 64 hex
 * chars or base64/base64url.
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

function entriesFromJson(keysJson: string): Array<[string, string]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(keysJson);
  } catch {
    throw new KeysetError('credentials_keys_bad_json');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new KeysetError('credentials_keys_bad_json');
  const entries: Array<[string, string]> = [];
  for (const [kid, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== 'string') throw new KeysetError('credentials_key_bad_encoding');
    entries.push([kid, value]);
  }
  return entries;
}

/**
 * Plain format: comma-separated `kid:key` pairs (e.g. `k1:BASE64KEY` or
 * `k1:KEY1,k2:KEY2`). Split each pair on the first colon only so key
 * material is never cut. Empty entries (including trailing commas) are
 * ignored. Duplicate kids are rejected.
 */
function entriesFromPlain(raw: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const colon = entry.indexOf(':');
    if (colon === -1) throw new KeysetError('credentials_keys_bad_json');
    const kid = entry.slice(0, colon).trim();
    const value = entry.slice(colon + 1).trim();
    if (seen.has(kid)) throw new KeysetError('credentials_bad_kid');
    seen.add(kid);
    entries.push([kid, value]);
  }
  return entries;
}

/**
 * Parse + validate a keyset. Throws KeysetError (code only, never key bytes)
 * when anything is missing or malformed — callers treat that as "not
 * configured" and fail closed. Accepts JSON or plain `kid:key` pairs.
 * CREDENTIALS_ACTIVE_KID may be omitted when the keyset has exactly one key.
 */
export function parseKeyset(keysRaw: string | undefined, activeKid: string | undefined): Keyset {
  if (!keysRaw?.trim()) throw new KeysetError('credentials_not_configured');
  const trimmed = keysRaw.trim();
  const pairs = trimmed.startsWith('{') ? entriesFromJson(trimmed) : entriesFromPlain(trimmed);
  const keys = new Map<string, Buffer>();
  for (const [kid, value] of pairs) {
    if (!KID_RE.test(kid)) throw new KeysetError('credentials_bad_kid');
    const master = decodeMasterKey(value);
    if (master.length < 32) throw new KeysetError('credentials_key_too_short');
    keys.set(kid, deriveKey(master, kid));
  }
  if (keys.size === 0) throw new KeysetError('credentials_not_configured');
  const kid = activeKid?.trim();
  if (!kid) {
    if (keys.size === 1) return { activeKid: [...keys.keys()][0]!, keys };
    throw new KeysetError('credentials_active_kid_missing');
  }
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
