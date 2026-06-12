import { z } from 'zod';
import { PRIORITIES, TODO_STATUSES } from '../enums';
import { SpaceFileSchema } from './space';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

// One row in the inline checklist that hangs off a to-do or goal. Stored
// JSONB on the row; the server treats the whole array as a full replace
// on update (no diffing).
export const ChecklistItemSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1).max(500),
  done: z.boolean().default(false),
});
export type ChecklistItem = z.infer<typeof ChecklistItemSchema>;

export const CreateTodoSchema = z.object({
  title: z.string().min(1).max(280),
  description: z.string().max(10_000).nullable().optional(),
  // F25: assignee is EITHER a user OR a group (or null). The DB CHECK
  // constraint rejects mixed assignments; callers must clear one when
  // setting the other.
  assigneeId: z.string().uuid().nullable().optional(),
  assigneeGroupId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  goalId: z.string().uuid().nullable().optional(),
  dueDate: isoDate.optional(),
  estimateMin: z.number().int().min(0).max(10_000).default(60),
  priority: z.enum(PRIORITIES).default('medium'),
  tags: z.array(z.string().max(40)).default([]),
  private: z.boolean().default(false),
  // Portal sharing (0029): opt this to-do into the client portal's project
  // view. Mutually pointless with `private` — the composer prevents both.
  sharedWithClient: z.boolean().default(false),
  checklist: z.array(ChecklistItemSchema).max(50).default([]),
  // F25: file attachments on the todo. Full-replace on update; uploads
  // append atomically via POST /api/todos/:id/files.
  attachments: z.array(SpaceFileSchema).max(50).default([]),
});
// Use z.input so callers may omit fields that have defaults (estimateMin,
// priority, tags, private, checklist) — the server applies them via zod.
export type CreateTodoInput = z.input<typeof CreateTodoSchema>;

export const UpdateTodoSchema = CreateTodoSchema.partial().extend({
  status: z.enum(TODO_STATUSES).optional(),
  loggedMin: z.number().int().min(0).max(1_000_000).optional(),
});
export type UpdateTodoInput = z.infer<typeof UpdateTodoSchema>;
