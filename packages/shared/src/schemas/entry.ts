import { z } from 'zod';
import { ENTRY_STATUSES } from '../enums';

export const StartTimerSchema = z.object({
  // Project is optional: timer can run against a to-do with no project, or
  // (in the future) with no to-do at all. When a todoId is provided and the
  // to-do has a projectId, the server will infer projectId from the to-do.
  projectId: z.string().uuid().nullable().optional(),
  note: z.string().max(500).default('Working'),
  todoId: z.string().uuid().nullable().optional(),
  // Optional provenance marker — when present, identifies a Notes-canvas
  // /timer block as the source so the block can render its "running" state.
  spaceBlockId: z.string().max(80).nullable().optional(),
});
export type StartTimerInput = z.infer<typeof StartTimerSchema>;

export const ManualEntrySchema = z
  .object({
    projectId: z.string().uuid().nullable().optional(),
    note: z.string().max(500).default(''),
    startIso: z.string().datetime({ offset: true }),
    endIso: z.string().datetime({ offset: true }),
    todoId: z.string().uuid().nullable().optional(),
    // Log time ON BEHALF of another workspace member. Only honored when the
    // caller has `time_entry.edit` (the route enforces it); everyone else
    // can only create entries for themselves.
    userId: z.string().uuid().optional(),
  })
  .refine((v) => new Date(v.endIso).getTime() > new Date(v.startIso).getTime(), {
    message: 'End must be after start',
    path: ['endIso'],
  })
  .refine(
    (v) => new Date(v.endIso).getTime() - new Date(v.startIso).getTime() <= 24 * 60 * 60 * 1000,
    { message: 'Entry cannot exceed 24 hours', path: ['endIso'] },
  );
export type ManualEntryInput = z.infer<typeof ManualEntrySchema>;

export const UpdateManualEntrySchema = z
  .object({
    projectId: z.string().uuid().nullable().optional(),
    note: z.string().max(500).optional(),
    startIso: z.string().datetime({ offset: true }).optional(),
    endIso: z.string().datetime({ offset: true }).optional(),
    todoId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (v) => !(v.startIso && v.endIso) || new Date(v.endIso).getTime() > new Date(v.startIso).getTime(),
    { message: 'End must be after start', path: ['endIso'] },
  );
export type UpdateManualEntryInput = z.infer<typeof UpdateManualEntrySchema>;

export const BulkIdsSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(1000),
});
export type BulkIdsInput = z.infer<typeof BulkIdsSchema>;

export const RejectEntriesSchema = BulkIdsSchema.extend({
  note: z.string().max(500).default('Returned for review'),
});
export type RejectEntriesInput = z.infer<typeof RejectEntriesSchema>;

export const EntryListQuerySchema = z.object({
  userId: z.string().uuid().optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  periodId: z.string().uuid().optional(),
  status: z.enum(ENTRY_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});
export type EntryListQuery = z.infer<typeof EntryListQuerySchema>;
