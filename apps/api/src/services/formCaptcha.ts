import type { FormCaptchaProvider } from '@allebrum/shared';
import type { Form } from '../db/schema.js';
import { env } from '../env.js';
import { decryptField } from '../lib/crypto.js';
import { loadKeyset } from './credentials.js';
import { TURNSTILE_VERIFY_URL } from './turnstileRules.js';

/**
 * Captcha key resolution + server-side verification for public form submits.
 * hCaptcha / reCAPTCHA keys are server-wide (env). Cloudflare Turnstile is
 * per-workspace (Admin → Integrations); a form may optionally override with
 * its own widget when a client site needs a separate hostname list.
 */

export const TURNSTILE_SECRET_FIELD = 'forms.turnstile_secret';
export { TURNSTILE_VERIFY_URL };

type TurnstileRow = Pick<Form, 'id' | 'tenantId' | 'turnstileSiteKey' | 'turnstileSecretEnc'>;

/** Sync helper for tests: form-level site key only (no workspace lookup). */
export function providerSiteKey(provider: FormCaptchaProvider | null, row?: Pick<Form, 'turnstileSiteKey'> | null): string | null {
  if (provider === 'hcaptcha') return env.HCAPTCHA_SITE_KEY ?? null;
  if (provider === 'recaptcha') return env.RECAPTCHA_SITE_KEY ?? null;
  if (provider === 'turnstile') return row?.turnstileSiteKey?.trim() || null;
  return null;
}

function decryptFormTurnstileSecret(row: TurnstileRow): string | null {
  if (!row.turnstileSecretEnc) return null;
  const { keyset } = loadKeyset();
  if (!keyset) {
    console.warn(`[forms] form ${row.id} has a Turnstile secret but the credentials keyset is not configured`);
    return null;
  }
  try {
    return decryptField(row.turnstileSecretEnc, { tenantId: row.tenantId, rowId: row.id, field: TURNSTILE_SECRET_FIELD }, keyset);
  } catch {
    console.warn(`[forms] form ${row.id} Turnstile secret could not be decrypted`);
    return null;
  }
}

/** Site key the embed renders. Form override wins; otherwise the workspace integration. */
export async function resolveCaptchaSiteKey(provider: FormCaptchaProvider | null, row: TurnstileRow): Promise<string | null> {
  if (provider !== 'turnstile') return providerSiteKey(provider, row);
  if (row.turnstileSiteKey?.trim()) return row.turnstileSiteKey.trim();
  const { getWorkspaceTurnstileKeys } = await import('./turnstile.js');
  const ws = await getWorkspaceTurnstileKeys(row.tenantId);
  return ws?.siteKey ?? null;
}

async function resolveCaptchaSecret(provider: FormCaptchaProvider | null, row: TurnstileRow): Promise<string | null> {
  if (provider === 'hcaptcha') return env.HCAPTCHA_SECRET ?? null;
  if (provider === 'recaptcha') return env.RECAPTCHA_SECRET ?? null;
  if (provider === 'turnstile') {
    if (row.turnstileSiteKey?.trim()) return decryptFormTurnstileSecret(row);
    const { getWorkspaceTurnstileKeys } = await import('./turnstile.js');
    const ws = await getWorkspaceTurnstileKeys(row.tenantId);
    return ws?.secret ?? null;
  }
  return null;
}

export function captchaVerifyEndpoint(provider: FormCaptchaProvider): string {
  if (provider === 'hcaptcha') return 'https://hcaptcha.com/siteverify';
  if (provider === 'turnstile') return TURNSTILE_VERIFY_URL;
  return 'https://www.google.com/recaptcha/api/siteverify';
}

export async function verifyCaptcha(args: {
  provider: FormCaptchaProvider;
  token: string;
  remoteIp: string | null;
  row: Form;
}): Promise<boolean> {
  const secret = await resolveCaptchaSecret(args.provider, args.row);
  if (!secret) return false;
  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', args.token);
  if (args.remoteIp) body.set('remoteip', args.remoteIp);

  try {
    const res = await fetch(captchaVerifyEndpoint(args.provider), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { success?: boolean };
    return !!json.success;
  } catch (e) {
    console.warn(`[forms] ${args.provider} verification request failed`, e);
    return false;
  }
}

