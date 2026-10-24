import { z } from 'zod';
import { SpaceBlockSchema } from './space';

/**
 * Personal access tokens ("bot tokens") let scripts and assistants act as a
 * user against a small, allow-listed slice of the API. See docs/BOT_API.md.
 */
export const API_TOKEN_SCOPES = ['read', 'notes:write', 'time:write'] as const;
export const ApiTokenScopeSchema = z.enum(API_TOKEN_SCOPES);
export type ApiTokenScope = z.infer<typeof ApiTokenScopeSchema>;

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
