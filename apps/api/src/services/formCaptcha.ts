import type { FormCaptchaProvider } from '@allebrum/shared';
import type { Form } from '../db/schema.js';
import { env } from '../env.js';
import { decryptField } from '../lib/crypto.js';
import { loadKeyset } from './credentials.js';

/**
 * Captcha key resolution + server-side verification for public form submits.
 * hCaptcha / reCAPTCHA keys are server-wide (env). Cloudflare Turnstile can
 * also be configured PER FORM (site key + encrypted secret on the form row)
 * because a Turnstile widget only works on the hostnames listed for it in
 * Cloudflare, and forms are embedded on many different client sites.
 */

export const TURNSTILE_SECRET_FIELD = 'forms.turnstile_secret';
export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Site key the embed renders. Turnstile: the form's own key wins over env. */
export function providerSiteKey(provider: FormCaptchaProvider | null, row?: Pick<Form, 'turnstileSiteKey'> | null): string | null {
  if (provider === 'hcaptcha') return env.HCAPTCHA_SITE_KEY ?? null;
  if (provider === 'recaptcha') return env.RECAPTCHA_SITE_KEY ?? null;
  if (provider === 'turnstile') return row?.turnstileSiteKey?.trim() || env.TURNSTILE_SITE_KEY || null;
  return null;
}

function decryptTurnstileSecret(row: Pick<Form, 'id' | 'tenantId' | 'turnstileSecretEnc'>): string | null {
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

/**
 * Server-side secret. Turnstile: a form with its OWN site key must use its own
 * secret (a mismatched env secret would always fail); otherwise the env default.
 */
function providerSecret(
  provider: FormCaptchaProvider | null,
  row?: Pick<Form, 'id' | 'tenantId' | 'turnstileSiteKey' | 'turnstileSecretEnc'> | null,
): string | null {
  if (provider === 'hcaptcha') return env.HCAPTCHA_SECRET ?? null;
  if (provider === 'recaptcha') return env.RECAPTCHA_SECRET ?? null;
  if (provider === 'turnstile') {
    if (row?.turnstileSiteKey?.trim()) return row ? decryptTurnstileSecret(row) : null;
    return env.TURNSTILE_SECRET ?? null;
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
  const secret = providerSecret(args.provider, args.row);
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

