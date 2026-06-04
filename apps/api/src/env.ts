import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

// Load workspace-root .env first, then apps/api/.env override.
loadEnv({ path: resolve(process.cwd(), '../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  COOKIE_DOMAIN: z.string().optional(),
  // Google OAuth (optional — the feature stays dormant until all three are set)
  GOOGLE_OAUTH_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_CLIENT_SECRET: z.string().optional(),
  OAUTH_REDIRECT_URL: z.string().url().optional(),
  // WebAuthn relying-party (defaults derived from WEB_ORIGIN)
  WEBAUTHN_RP_ID: z.string().optional(),
  WEBAUTHN_ORIGIN: z.string().url().optional(),
  // Google Drive media manager (reuses the Google OAuth client; redirect
  // defaults to the API origin's drive callback path)
  DRIVE_OAUTH_REDIRECT_URL: z.string().url().optional(),
  // Gmail send (per-user OAuth for transactional invites + resets; reuses
  // the Google OAuth client and defaults the redirect like Drive does)
  GMAIL_OAUTH_REDIRECT_URL: z.string().url().optional(),
  // Production bootstrap (consumed only by `db:init`; the API itself does
  // not require these, so they stay optional here and are validated there).
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(8).optional(),
  ALLOWED_EMAIL_DOMAINS: z.string().optional(),
  // Hoppa SaaS — billing lives in the separate MARKETING service, which owns
  // Stripe and writes the `tenants` billing columns directly in THIS database.
  // The portal only READS them to gate, and exposes the identity provisioning
  // contract (mounted only when PROVISIONING_SECRET is set). All optional →
  // self-host runs ungated with no billing.
  PROVISIONING_SECRET: z.string().optional(),    // HMAC shared secret with the marketing billing service
  MARKETING_ORIGIN: z.string().url().optional(), // marketing base URL (in-app "manage billing" redirect)
  // Gate enforcement: false (self-host / pre-billing) → every workspace active;
  // SaaS sets true to block past_due / canceled / trialing-without-card. String→
  // bool so "false" isn't truthy.
  BILLING_ENFORCED: z.string().optional().transform((v) => v === 'true' || v === '1'),
  // Self-host single-container mode: when "true"/"1", the API also serves the
  // pre-built static web app (apps/web/out) at / so one process serves the
  // whole product on one origin. Off in the SaaS deploy, where the web is a
  // separate static site. (z.coerce.boolean would treat "false" as truthy.)
  SERVE_WEB: z.string().optional().transform((v) => v === 'true' || v === '1'),
  WEB_DIST_DIR: z.string().optional(),                // path to apps/web/out (defaults derived in index.ts)
});

export const env = EnvSchema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';
export const googleOAuthConfigured = !!(
  env.GOOGLE_OAUTH_CLIENT_ID &&
  env.GOOGLE_OAUTH_CLIENT_SECRET &&
  env.OAUTH_REDIRECT_URL
);

export const webauthnOrigin = env.WEBAUTHN_ORIGIN ?? env.WEB_ORIGIN;
export const webauthnRpId = env.WEBAUTHN_RP_ID ?? new URL(webauthnOrigin).hostname;

// Drive uses the same Google OAuth app; just a distinct redirect path.
export const driveRedirectUrl =
  env.DRIVE_OAUTH_REDIRECT_URL ??
  (env.OAUTH_REDIRECT_URL
    ? env.OAUTH_REDIRECT_URL.replace(/\/api\/auth\/google\/callback$/, '/api/integrations/drive/callback')
    : undefined);
export const driveOAuthConfigured = !!(
  env.GOOGLE_OAUTH_CLIENT_ID &&
  env.GOOGLE_OAUTH_CLIENT_SECRET &&
  driveRedirectUrl
);

// Gmail OAuth — same shape as Drive (same client, distinct redirect path).
export const gmailRedirectUrl =
  env.GMAIL_OAUTH_REDIRECT_URL ??
  (env.OAUTH_REDIRECT_URL
    ? env.OAUTH_REDIRECT_URL.replace(/\/api\/auth\/google\/callback$/, '/api/integrations/gmail/callback')
    : undefined);
export const gmailOAuthConfigured = !!(
  env.GOOGLE_OAUTH_CLIENT_ID &&
  env.GOOGLE_OAUTH_CLIENT_SECRET &&
  gmailRedirectUrl
);

// The identity provisioning contract (marketing → portal) is only mounted when
// its shared HMAC secret is set.
export const provisioningConfigured = !!env.PROVISIONING_SECRET;

// Subscription gate enforcement. False (self-host / pre-billing) → every
// workspace is treated active; SaaS sets BILLING_ENFORCED=true to gate.
export const billingEnforced = env.BILLING_ENFORCED;
