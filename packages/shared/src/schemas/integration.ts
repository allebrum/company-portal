import { z } from 'zod';
import { INTEGRATION_KINDS } from '../enums';

export const ConnectIntegrationSchema = z.object({
  account: z.string().max(240).optional(),
  autoSync: z.boolean().optional(),
  syncIntervalHours: z.number().int().min(1).max(168).optional(),
  config: z.record(z.unknown()).optional(),
});
export type ConnectIntegrationInput = z.infer<typeof ConnectIntegrationSchema>;

export const IntegrationKindParam = z.object({
  kind: z.enum(INTEGRATION_KINDS),
});

export const LinkFolderSchema = z.object({
  drivePath: z.string().min(1).max(500),
  clientId: z.string().uuid(),
  itemCount: z.number().int().min(0).max(1_000_000).default(0),
});
export type LinkFolderInput = z.infer<typeof LinkFolderSchema>;

/** Free-plan hostname cap per Turnstile widget. Enterprise is 200. */
export const TURNSTILE_HOSTNAME_CAP_FREE = 10;
export const TURNSTILE_HOSTNAME_CAP_ENTERPRISE = 200;

const HostnameSchema = z
  .string()
  .trim()
  .min(1)
  .max(253);

/** Write-only: omitted = keep stored; null / '' = clear. */
export const TurnstileSaveSchema = z.object({
  siteKey: z.string().trim().max(200).nullable().optional(),
  secret: z.string().trim().max(400).nullable().optional(),
  accountId: z.string().trim().max(64).nullable().optional(),
  /** Cloudflare API token (Account > Turnstile > Edit). Write-only. */
  apiToken: z.string().trim().max(400).nullable().optional(),
  hostnames: z.array(HostnameSchema).max(TURNSTILE_HOSTNAME_CAP_ENTERPRISE).optional(),
  /** When true, hostname cap is 200 (Cloudflare Turnstile Enterprise). */
  enterprise: z.boolean().optional(),
  /**
   * If an API token is present and there is no site key yet, create a widget
   * in the company's Cloudflare account and store the returned keys.
   */
  createWidget: z.boolean().optional(),
  /** Push the Allowed domains list to the existing widget via the API token. */
  syncHostnames: z.boolean().optional(),
});
export type TurnstileSaveInput = z.infer<typeof TurnstileSaveSchema>;

export const TurnstileTestSchema = z.object({
  /** Optional unsaved secret to test without writing it. Otherwise uses the stored one. */
  secret: z.string().trim().min(1).max(400).optional(),
});
export type TurnstileTestInput = z.infer<typeof TurnstileTestSchema>;

export const TurnstileSyncSchema = z.object({
  /** Also add hostnames taken from every form's allowedOrigins. */
  includeFormOrigins: z.boolean().optional().default(false),
  hostnames: z.array(HostnameSchema).max(TURNSTILE_HOSTNAME_CAP_ENTERPRISE).optional(),
});
export type TurnstileSyncInput = z.infer<typeof TurnstileSyncSchema>;

export type TurnstileStatus = {
  connected: boolean;
  siteKey: string | null;
  hasSecret: boolean;
  accountId: string | null;
  hasApiToken: boolean;
  hostnames: string[];
  enterprise: boolean;
  secretStorageReady: boolean;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastSyncAt: string | null;
};

export type TurnstileTestResult = {
  ok: boolean;
  /** Short machine code, e.g. invalid_secret, secret_ok, not_configured. */
  code: string;
  message: string;
};
