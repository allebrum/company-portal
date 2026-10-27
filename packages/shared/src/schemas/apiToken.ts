import { z } from 'zod';
import { SpaceBlockSchema } from './space';

/**
 * Personal access tokens ("bot tokens") let scripts and assistants act as the
 * user who created them, through the SAME routes the web app uses. Scopes cap
 * which resource areas a token may touch; the owner's live RBAC permissions
 * still apply on top, so a token can never do more than its owner can right
 * now. See docs/BOT_API.md.
 *
 * Scope strings are stored as-is on each token row, so existing tokens
 * (`read`, `notes:write`, `time:write`) keep working unchanged. Never rename
 * a scope; add new ones.
 */
export const API_TOKEN_SCOPES = [
  'read',
  'notes:write',
  'time:write',
  'time:manage',
  'clients:write',
  'projects:write',
  'roadmap:write',
  'tickets:write',
  'files:write',
  'tools:write',
  'finance:write',
  'team:admin',
  'secrets:read',
  'full',
] as const;
export const ApiTokenScopeSchema = z.enum(API_TOKEN_SCOPES);
export type ApiTokenScope = z.infer<typeof ApiTokenScopeSchema>;

/** `full` = everything the owner can do (minus session-only routes), including scopes added later. */
export const FULL_ACCESS_SCOPE = 'full' satisfies ApiTokenScope;

/** Human-readable description of each scope (token UI, docs, /api/me/capabilities). */
export const API_TOKEN_SCOPE_INFO: Record<ApiTokenScope, { label: string; description: string }> = {
  read: {
    label: 'Read',
    description:
      'Read workspace data: clients, projects, notes, time & timers, roadmap, to-dos, tickets, team, activity, settings, pay periods, forms, QR codes, websites (no stored credentials).',
  },
  'notes:write': {
    label: 'Notes',
    description: 'Add, edit, reorder and delete Notes blocks in client/project Spaces.',
  },
  'time:write': {
    label: 'Log time',
    description: 'Start/stop timers, log and edit time entries.',
  },
  'time:manage': {
    label: 'Manage time',
    description: 'Delete time entries, submit time for approval, approve / reject / reopen (if your role allows).',
  },
  'clients:write': {
    label: 'Clients',
    description: 'Create and edit clients, and manage client-portal contacts.',
  },
  'projects:write': {
    label: 'Projects',
    description: 'Create and edit projects.',
  },
  'roadmap:write': {
    label: 'Roadmap & to-dos',
    description: 'Create, edit, move and delete goals, epics, milestones and to-dos (tasks).',
  },
  'tickets:write': {
    label: 'Tickets',
    description: 'Reply to, triage and close client-portal tickets.',
  },
  'files:write': {
    label: 'Files',
    description: 'Upload, rename and delete files in Spaces, to-dos, goals and Google Drive.',
  },
  'tools:write': {
    label: 'Tools',
    description: 'Create, edit and delete forms, QR codes and websites.',
  },
  'finance:write': {
    label: 'Payroll & invoicing',
    description: 'Manage pay periods, pay config and client invoicing (incl. QuickBooks invoices).',
  },
  'team:admin': {
    label: 'Team admin',
    description: 'Invite, edit and remove users; manage groups & permissions; workspace branding/settings; sample data.',
  },
  'secrets:read': {
    label: 'Website credentials',
    description: 'Read stored website credentials from the website memory bank.',
  },
  full: {
    label: 'Full access (same as me)',
    description:
      'Everything you can do in Hoppa, including features added later — except session-only security actions (tokens, password, 2FA, login).',
  },
};

export const CreateApiTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scopes: z.array(ApiTokenScopeSchema).min(1).max(API_TOKEN_SCOPES.length),
  /** Days until expiry; omit/null for a non-expiring token. */
  expiresInDays: z.number().int().min(1).max(365).nullable().optional(),
});
export type CreateApiTokenInput = z.infer<typeof CreateApiTokenSchema>;

export interface ApiTokenSummary {
  id: string;
  name: string;
  /** First characters of the token, for recognising it in the list. */
  prefix: string;
  scopes: ApiTokenScope[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

/** Returned once, at creation. `token` is never retrievable again. */
export interface CreatedApiToken extends ApiTokenSummary {
  token: string;
}

/** Block types a token may append. Linked cards (todo/goal/timer/link) need real ids, so they're excluded. */
export const APPENDABLE_BLOCK_TYPES = [
  'text', 'h1', 'h2', 'h3', 'bullet', 'numbered', 'checkbox', 'quote', 'callout', 'divider', 'embed',
] as const;

/**
 * Append-only notes write. Ids are always assigned by the server, so a bot
 * can never collide with or overwrite existing blocks. Multi-line `text`
 * content is split into one block per line (the Notes model).
 */
export const AppendSpaceBlocksSchema = z.object({
  blocks: z
    .array(
      SpaceBlockSchema.pick({ content: true, checked: true, embedUrl: true, embedKind: true }).extend({
        type: z.enum(APPENDABLE_BLOCK_TYPES).default('text'),
      }),
    )
    .min(1)
    .max(200),
});
export type AppendSpaceBlocksInput = z.infer<typeof AppendSpaceBlocksSchema>;

/**
 * Edit one Notes block in place (by id). Linked card types can't be set here;
 * to change a block's type pick another appendable type.
 */
export const UpdateSpaceBlockSchema = z
  .object({
    type: z.enum(APPENDABLE_BLOCK_TYPES).optional(),
    content: z.string().max(20_000).optional(),
    checked: z.boolean().optional(),
    embedUrl: z.string().url().max(2000).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'empty_patch' });
export type UpdateSpaceBlockInput = z.infer<typeof UpdateSpaceBlockSchema>;

/** One entry of GET /api/me/capabilities `actions`. */
export interface TokenActionInfo {
  method: string;
  /** Express-style path, e.g. `/api/projects/:id`. */
  path: string;
  /** Scope that unlocks it; `null` = any valid token. */
  scope: ApiTokenScope | null;
  /** True when the calling credential holds that scope (RBAC may still deny). */
  allowed: boolean;
  /** Body fields that are session-only even when the route is allowed. */
  sessionOnlyFields?: string[];
  note?: string;
}

export interface CapabilitiesResponse {
  via: 'token' | 'session';
  user: { id: string; name: string; email: string };
  tenantId: string;
  token: { id: string; name: string; scopes: ApiTokenScope[]; expiresAt: string | null } | null;
  /** Scopes in effect (expanded: `full` → every scope). Session = every scope. */
  effectiveScopes: ApiTokenScope[];
  /** The owner's live RBAC permissions in this workspace (the hard ceiling). */
  permissions: string[];
  actions: TokenActionInfo[];
  /** Routes no token can ever reach, with the reason. */
  sessionOnly: { method: string; path: string; reason: string }[];
}
