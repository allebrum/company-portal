import { z } from 'zod';
import { RESOURCE_KINDS } from '../enums';

/**
 * One block in a Client/Project Space's Notes canvas.
 *
 * The schema is intentionally flat / loose rather than a discriminated union
 * because every field is optional per-type and TypeScript's discriminated
 * unions add a lot of ceremony for callers that already know what they want
 * to insert. The Notes UI is the authoritative validator of which fields
 * are actually meaningful for each `type`.
 */
export const SpaceBlockSchema = z.object({
  id: z.string().min(1).max(80),
  type: z.enum([
    'text', 'h1', 'h2', 'h3',
    'bullet', 'numbered', 'checkbox',
    'quote', 'callout', 'divider',
    'todo', 'goal', 'link', 'embed', 'timer',
  ]),
  content: z.string().max(20_000).optional(),
  checked: z.boolean().optional(),
  todoId: z.string().uuid().nullable().optional(),
  goalId: z.string().uuid().nullable().optional(),
  linkType: z.enum(['goal', 'todo', 'file']).optional(),
  linkRefId: z.string().min(1).max(80).optional(),
  embedUrl: z.string().max(2_000).optional(),
  embedKind: z.enum(['figma', 'github', 'drive', 'link']).optional(),
  projectId: z.string().uuid().nullable().optional(),
});
export type SpaceBlock = z.infer<typeof SpaceBlockSchema>;

/**
 * A file or external link attached to a Space's Files tab.
 *
 * `source = 'notes'` indicates the entry was inserted via the `/embed`
 * block in the Notes canvas; the Files tab shows a "from Notes" badge for
 * those. `source = 'files'` is for direct uploads / pastes from the Files
 * tab itself.
 *
 * For real uploads via Drive, `url` is the Drive `webViewLink` and we leave
 * the Drive file id in `meta` so the row can be deleted from the Drive
 * folder later if we choose.
 */
export const SpaceFileSchema = z.object({
  id: z.string().min(1).max(80),
  kind: z.enum(RESOURCE_KINDS),
  title: z.string().min(1).max(400),
  url: z.string().min(1).max(2_000),
  meta: z.string().max(400).optional(),
  source: z.enum(['notes', 'files']).default('files'),
  addedBy: z.string().uuid(),
  addedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type SpaceFile = z.infer<typeof SpaceFileSchema>;
