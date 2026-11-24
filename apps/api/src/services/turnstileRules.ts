import {
  TURNSTILE_HOSTNAME_CAP_ENTERPRISE,
  TURNSTILE_HOSTNAME_CAP_FREE,
  type TurnstileTestResult,
} from '@allebrum/shared';

/** Pure Turnstile helpers (no DB / crypto) so they stay unit-testable. */

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function hostnameCap(enterprise: boolean): number {
  return enterprise ? TURNSTILE_HOSTNAME_CAP_ENTERPRISE : TURNSTILE_HOSTNAME_CAP_FREE;
}

/**
 * Normalize a user-entered origin or hostname to a bare FQDN.
 * Cloudflare rejects schemes, ports, paths, and wildcards; adding a root
 * domain automatically covers its subdomains.
 */
export function normalizeHostname(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  try {
    if (s.includes('://')) s = new URL(s).hostname;
  } catch {
    return null;
  }
  s = s.split('/')[0] ?? s;
  s = s.replace(/^\[/, '').replace(/\]$/, '');
  s = s.replace(/:\d+$/, '');
  s = s.replace(/^\./, '').replace(/\.$/, '');
  if (s === 'localhost' || s.endsWith('.localhost')) return s;
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(s) && s !== 'localhost') {
    // allow single-label only for localhost (already returned); otherwise need a dot
    return null;
  }
  return s;
}

export function normalizeHostnames(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of raw) {
    const h = normalizeHostname(r);
    if (!h || seen.has(h)) continue;
    seen.add(h);
    out.push(h);
  }
  return out;
}


export type Siteverify = { success?: boolean; 'error-codes'?: string[] };

/**
 * Interpret a siteverify result for the Test button. A dummy token is
 * expected to fail; `invalid-input-secret` means the secret itself is wrong,
 * while `invalid-input-response` / `missing-input-response` means the secret
 * was accepted.
 */
export function interpretSiteverify(json: Siteverify): TurnstileTestResult {
  const codes = json['error-codes'] ?? [];
  if (json.success) {
    return { ok: true, code: 'secret_ok', message: 'The secret key is valid.' };
  }
  if (codes.includes('invalid-input-secret') || codes.includes('missing-input-secret')) {
    return {
      ok: false,
      code: 'invalid_secret',
      message: 'That secret key isn’t valid. Check you copied the widget’s secret, not the site key.',
    };
  }
  if (
    codes.includes('invalid-input-response') ||
    codes.includes('missing-input-response') ||
    codes.includes('timeout-or-duplicate') ||
    codes.includes('expired-input-response')
  ) {
    return { ok: true, code: 'secret_ok', message: 'The secret key is valid.' };
  }
  return {
    ok: false,
    code: 'verify_failed',
    message: codes.length ? `Cloudflare rejected the test (${codes.join(', ')}).` : 'Cloudflare rejected the test. Try again.',
  };
}
