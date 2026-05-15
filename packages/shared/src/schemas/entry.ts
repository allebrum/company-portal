import { z } from 'zod';
import { ENTRY_STATUSES } from '../enums';

export const StartTimerSchema = z.object({
  projectId: z.string().uuid(),
  note: z.string().max(500).default('Working'),
  todoId: z.string().uuid().nullable().optional(),
});
export type StartTimerInput = z.infer<typeof StartTimerSchema>;

export const ManualEntrySchema = z.object({
  projectId: z.string().uuid(),
  note: z.string().max(500).default(''),
  startIso: z.string().datetime({ offset: true }),
  durationMin: z.number().int().min(1).max(24 * 60),
  todoId: z.string().uuid().nullable().optional(),
});
export type ManualEntryInput = z.infer<typeof ManualEntrySchema>;

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
