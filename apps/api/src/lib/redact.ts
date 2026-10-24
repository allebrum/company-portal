/**
 * Last line of defence against leaking credentials in API responses and
 * realtime payloads.
 *
 * The primary protection is explicit column selection / `toPublicUser` in the
 * services: user-facing code never loads secrets in the first place. This
 * module is the backstop for when someone later writes `res.json(row)` with
 * a full DB row. It is wired in two places:
 *   - `app.set('json replacer', secretsReplacer)` — every `res.json(...)`.
 *   - `emit.*` in realtime/emit.ts — every socket.io payload.
 *
 * Keys are matched exactly (no fuzzy "contains token" matching) so ordinary
 * user content is never silently altered.
 */

/** Keys that are always secret, wherever they appear. */
export const ALWAYS_SECRET_KEYS: ReadonlySet<string> = new Set([
  // users.password_hash
  'passwordHash',
  'password_hash',
  // users.google_sub — a stable Google account id; nothing client-side needs it
  'googleSub',
  'google_sub',
  // auth_tokens (invite / reset / portal magic link) and api_tokens
  'tokenHash',
  'token_hash',
  // user_recovery_codes
  'codeHash',
  'code_hash',
  // oauth_tokens (Google Drive / Gmail / QuickBooks)
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  // websites: encrypted stored credentials
  'credentialUsernameEnc',
  'credentialPasswordEnc',
  'credential_username_enc',
  'credential_password_enc',
]);

/**
 * Keys that are secret only when they sit on a per-user credential row
 * (an object that also carries `userId`): user_totp.secret and
 * webauthn_credentials.publicKey/counter. `secret` alone is too generic a
 * word to strip from arbitrary content.
 */
export const USER_ROW_SECRET_KEYS: ReadonlySet<string> = new Set(['secret', 'publicKey', 'counter']);

function holderIsUserCredentialRow(holder: unknown): boolean {
  return !!holder && typeof holder === 'object' && !Array.isArray(holder) && 'userId' in (holder as object);
}

export function isSecretKey(key: string, holder: unknown): boolean {
  if (ALWAYS_SECRET_KEYS.has(key)) return true;
  return USER_ROW_SECRET_KEYS.has(key) && holderIsUserCredentialRow(holder);
}

/** `JSON.stringify` replacer — returning undefined drops the key. */
export function secretsReplacer(this: unknown, key: string, value: unknown): unknown {
  if (key !== '' && isSecretKey(key, this)) return undefined;
  return value;
}

/**
 * Deep copy with secret keys removed. Plain objects and arrays only; other
 * values (Dates, Buffers, class instances) pass through untouched, matching
 * what socket.io would serialize.
 */
export function redactSecrets<T>(value: T, ancestors: Set<object> = new Set()): T {
  if (value === null || typeof value !== 'object') return value;
  // Cycle guard on the current path only. A *shared* (non-cyclic) object that
  // appears twice must be redacted both times, so this is not a global "seen".
  if (ancestors.has(value as object)) return undefined as T;
  const isArr = Array.isArray(value);
  if (!isArr) {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
  }
  ancestors.add(value as object);
  try {
    if (isArr) return (value as unknown[]).map((v) => redactSecrets(v, ancestors)) as unknown as T;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (isSecretKey(k, value)) continue;
      out[k] = redactSecrets(v, ancestors);
    }
    return out as T;
  } finally {
    ancestors.delete(value as object);
  }
}
