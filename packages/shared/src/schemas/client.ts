import { z } from 'zod';
import { CLIENT_KINDS } from '../enums';
import { SpaceBlockSchema, SpaceFileSchema } from './space';

export const CreateClientSchema = z.object({
  name: z.string().min(1).max(160),
  kind: z.enum(CLIENT_KINDS).default('agency'),
  color: z.string().max(20).default('#7e22ce'),
});
// z.input so callers can create with just { name } (kind/color default).
export type CreateClientInput = z.input<typeof CreateClientSchema>;

// F23 client portal — slug pattern. Lowercase alphanumerics + hyphens,
// must start with alphanumeric, 3–40 chars. The deny list rejects slugs
// that would shadow internal routes once mounted under /portal/.
export const PORTAL_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{2,39}$/;
export const PORTAL_SLUG_RESERVED = new Set([
  'admin', 'api', 'login', 'logout', 'portal', 'staff', 'tickets',
  'new', 'access', 'check-email', 'invite', 'me',
]);
export const portalSlugSchema = z
  .string()
  .toLowerCase()
  .refine((v) => PORTAL_SLUG_PATTERN.test(v), 'invalid_slug')
  .refine((v) => !PORTAL_SLUG_RESERVED.has(v), 'reserved_slug');

export const UpdateClientSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  kind: z.enum(CLIENT_KINDS).optional(),
  color: z.string().max(20).optional(),
  // Notes canvas + files for the client's Space. Both full-replace on
  // update — the server doesn't diff the array; clients send the whole
  // list when a block is added/removed/converted.
  spaceBlocks: z.array(SpaceBlockSchema).max(2000).optional(),
  spaceFiles: z.array(SpaceFileSchema).max(500).optional(),
  // F23 portal config — null clears the slug. Optional so other PATCHes
  // don't have to roundtrip the field.
  portalSlug: portalSlugSchema.nullable().optional(),
  // ISO timestamp string or null. Null = unpublished (slug exists but
  // public lookup 404s). Setting/clearing controls public visibility.
  portalPublishedAt: z.string().nullable().optional(),
});
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>;
