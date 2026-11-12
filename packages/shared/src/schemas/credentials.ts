import { z } from 'zod';

/**
 * Project / client credentials vault.
 *
 * Secret values (password/key, notes, TOTP seed) are encrypted at rest and
 * are NEVER part of a list response, bootstrap, activity, or socket payload.
 * They come back only from `POST /credentials/:id/reveal`, one credential
 * at a time, and every reveal is written to the credential access log.
 */
export const CREDENTIAL_KINDS = ['server', 'ssh', 'database', 'hosting', 'registrar', 'email', 'api_key', 'other'] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

export const CREDENTIAL_KIND_LABELS: Record<CredentialKind, string> = {
  server: 'Server',
  ssh: 'SSH',
  database: 'Database',
  hosting: 'Hosting',
  registrar: 'Domain registrar',
  email: 'Email',
  api_key: 'API key',
  other: 'Other',
};

const trimmed = (max: number) => z.string().trim().max(max);

/** A base32 TOTP seed (spaces allowed, stripped server-side) or an otpauth:// URI. */
const TotpSeedSchema = z
  .string()
  .trim()
  .max(2000)
  .refine(
    (v) => v === '' || /^otpauth:\/\//i.test(v) || /^[A-Z2-7= ]{8,}$/i.test(v),
    'Expected a base32 secret or an otpauth:// URI',
  );

export const CreateCredentialSchema = z
  .object({
    clientId: z.string().uuid().nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
    label: trimmed(160).min(1),
    kind: z.enum(CREDENTIAL_KINDS).default('other'),
    host: trimmed(500).optional().default(''),
    port: z.number().int().min(1).max(65535).nullable().optional(),
    url: trimmed(2000).optional().default(''),
    username: trimmed(320).optional().default(''),
    secret: z.string().max(10_000).optional().default(''),
    notes: z.string().max(10_000).optional().default(''),
    totpSecret: TotpSeedSchema.optional().default(''),
  })
  .refine((v) => !!v.clientId !== !!v.projectId, {
    message: 'Provide exactly one of clientId or projectId',
    path: ['clientId'],
  });
export type CreateCredentialInput = z.input<typeof CreateCredentialSchema>;

/**
 * Patch. Omitted fields are unchanged. For the encrypted fields, an empty
 * string clears the stored value.
 */
export const UpdateCredentialSchema = z.object({
  label: trimmed(160).min(1).optional(),
  kind: z.enum(CREDENTIAL_KINDS).optional(),
  host: trimmed(500).optional(),
  port: z.number().int().min(1).max(65535).nullable().optional(),
  url: trimmed(2000).optional(),
  username: trimmed(320).optional(),
  secret: z.string().max(10_000).optional(),
  notes: z.string().max(10_000).optional(),
  totpSecret: TotpSeedSchema.optional(),
});
export type UpdateCredentialInput = z.infer<typeof UpdateCredentialSchema>;

/** List row — metadata only, never a secret value. */
export interface CredentialRow {
  id: string;
  /** Set for client-level credentials. */
  clientId: string | null;
  /** Set for project-level credentials. */
  projectId: string | null;
  /** Project name when project-level (for the client rollup). */
  projectName: string | null;
  label: string;
  kind: CredentialKind;
  host: string;
  port: number | null;
  url: string;
  username: string;
  hasSecret: boolean;
  hasNotes: boolean;
  hasTotp: boolean;
  secretUpdatedAt: string | null;
  lastRevealedAt: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What the caller may do with credentials on one client. */
export interface CredentialAccess {
  /** False when CREDENTIALS_KEYS / CREDENTIALS_ACTIVE_KID aren't set (or invalid) on the server. */
  configured: boolean;
  canView: boolean;
  canReveal: boolean;
  canManage: boolean;
  /** Edit the client's allowlist + read the access log (tenant-wide credentials.manage, session only). */
  canManageAccess: boolean;
  /** True when access comes from the client's allowlist rather than a workspace-wide permission. */
  viaAllowlist: boolean;
}

export interface CredentialListResponse {
  access: CredentialAccess;
  credentials: CredentialRow[];
}

/** `POST /credentials/:id/reveal` — the only response that ever carries values. */
export interface CredentialReveal {
  credentialId: string;
  username: string;
  secret: string | null;
  notes: string | null;
  /** Current one-time code when a TOTP seed is stored (the seed itself never leaves the server). */
  totp: { code: string; expiresInSec: number } | null;
}

export interface CredentialAllowlistEntry {
  userId: string;
  canManage: boolean;
  grantedByUserId: string | null;
  createdAt: string;
}

export interface CredentialAllowlistResponse {
  entries: CredentialAllowlistEntry[];
  /** Members who already have workspace-wide credentials access (e.g. Owners) — the list doesn't apply to them. */
  workspaceWideUserIds: string[];
}

export const SetCredentialAllowlistSchema = z.object({
  entries: z
    .array(z.object({ userId: z.string().uuid(), canManage: z.boolean().default(false) }))
    .max(200),
});
export type SetCredentialAllowlistInput = z.input<typeof SetCredentialAllowlistSchema>;

export const CREDENTIAL_LOG_ACTIONS = ['reveal', 'create', 'update', 'delete', 'access.update'] as const;
export type CredentialLogAction = (typeof CREDENTIAL_LOG_ACTIONS)[number];

export const CREDENTIAL_LOG_OUTCOMES = ['ok', 'denied', 'not_found', 'rate_limited', 'not_configured', 'decrypt_failed'] as const;
export type CredentialLogOutcome = (typeof CREDENTIAL_LOG_OUTCOMES)[number];

export interface CredentialAccessLogRow {
  id: string;
  credentialId: string | null;
  clientId: string | null;
  label: string;
  userId: string | null;
  tokenId: string | null;
  tokenName: string | null;
  action: CredentialLogAction;
  outcome: CredentialLogOutcome;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}
