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
  // Hoppa (Phase 3) — the separate marketing site that owns Stripe billing +
  // subscription truth. All optional: when unset, subscription gating no-ops
  // to "allow" and the provisioning webhook is disabled, so Hoppa boots and
  // runs even before the marketing site exists.
  MARKETING_API_URL: z.string().url().optional(),     // e.g. https://hoppa.app/api
  MARKETING_API_KEY: z.string().optional(),           // bearer for subscription/billing reads
  PROVISIONING_SECRET: z.string().optional(),         // HMAC shared secret for the inbound provisioning webhook
  // Self-host single-container mode: when "true"/"1", the API also serves the
  // pre-built static web app (apps/web/out) at / so one process serves the
  // whole product on one origin. Off in the SaaS deploy, where the web is a
  // separate static site. (z.coerce.boolean would treat "false" as truthy.)
  SERVE_WEB: z.string().optional().transform((v) => v === 'true' || v === '1'),
  WEB_DIST_DIR: z.string().optional(),                // path to apps/web/out (defaults derived in index.ts)
  // Custom Stripe billing (consolidated in-app). All optional: when
  // STRIPE_SECRET_KEY is unset, billing is dormant and gating allows everyone
  // (self-host / pre-billing). We own the 30-day trial + recurring schedule;
  // Stripe only stores the card and runs the off-session charges (no Stripe
  // Prices/Products/Subscriptions).
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),      // surfaced to the browser via GET /billing/config
  MONTHLY_PRICE_CENTS: z.coerce.number().int().min(0).default(0),  // smallest unit, e.g. 2999 = $29.99
  BILLING_CURRENCY: z.string().default('usd'),
  TRIAL_DAYS: z.coerce.number().int().min(0).default(30),
  BILLING_INTERVAL_DAYS: z.coerce.number().int().min(1).default(30),
  BILLING_MAX_RETRIES: z.coerce.number().int().min(1).default(4),  // past_due retries before canceled
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

// Hoppa: the subscription API is "configured" only when both the base URL and
// the API key are present. When false, gating allows everything (single
// self-hosted workspace mode / pre-marketing-site).
export const subscriptionsConfigured = !!(env.MARKETING_API_URL && env.MARKETING_API_KEY);
// The provisioning webhook is only mounted/active when its HMAC secret is set.
export const provisioningConfigured = !!env.PROVISIONING_SECRET;

// Custom Stripe billing is active only when the secret key is set. When false,
// signup/charges are disabled and subscription gating allows everyone (the
// app runs as a single self-hosted workspace with no billing).
export const billingConfigured = !!env.STRIPE_SECRET_KEY;
// Stripe webhook signature verification needs the webhook secret too.
export const billingWebhookConfigured = !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET);
