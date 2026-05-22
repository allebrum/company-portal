import { z } from 'zod';
import { GOAL_STATUSES, PRIORITIES, RESOURCE_KINDS } from '../enums';
import { ChecklistItemSchema } from './todo';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const CreateGoalSchema = z.object({
  clientId: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1).max(240),
  description: z.string().max(10_000).nullable().optional(),
  status: z.enum(GOAL_STATUSES).default('backlog'),
  ownerId: z.string().uuid().nullable().optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  priority: z.enum(PRIORITIES).default('medium'),
  tag: z.string().max(60).default('Delivery'),
  checklist: z.array(ChecklistItemSchema).max(50).default([]),
});
// Use z.input so callers may omit fields that have defaults (status,
// priority, tag, checklist) — the server applies them via zod.
export type CreateGoalInput = z.input<typeof CreateGoalSchema>;

export const UpdateGoalSchema = CreateGoalSchema.partial();
export type UpdateGoalInput = z.infer<typeof UpdateGoalSchema>;

export const MoveGoalSchema = z.object({
  status: z.enum(GOAL_STATUSES),
});
export type MoveGoalInput = z.infer<typeof MoveGoalSchema>;

export const AddResourceSchema = z.object({
  kind: z.enum(RESOURCE_KINDS),
  title: z.string().min(1).max(240),
  url: z.string().max(2048).default(''),
  meta: z.string().max(240).default(''),
});
export type AddResourceInput = z.infer<typeof AddResourceSchema>;
