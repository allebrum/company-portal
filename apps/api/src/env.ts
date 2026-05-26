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
