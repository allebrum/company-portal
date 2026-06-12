import { z } from 'zod';
import { PRIORITIES, RESOURCE_KINDS, HEALTHS } from '../enums';
import { ChecklistItemSchema } from './todo';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const CreateGoalSchema = z.object({
  // Both optional since 0026: neither → a workspace-level goal; client-only
  // is allowed; a project requires its client (refined below).
  clientId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(240),
  description: z.string().max(10_000).nullable().optional(),
  // Free-form status (default workflow OR a project's custom workflow id).
  status: z.string().min(1).max(60).default('backlog'),
  // F25: owner is EITHER a user OR a group (or null). The DB CHECK
  // constraint rejects mixed ownership; callers must clear one when
  // setting the other.
  ownerId: z.string().uuid().nullable().optional(),
  ownerGroupId: z.string().uuid().nullable().optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  priority: z.enum(PRIORITIES).default('medium'),
  tag: z.string().max(60).default('Delivery'),
  checklist: z.array(ChecklistItemSchema).max(50).default([]),
  // PM workspace extensions
  epicId: z.string().uuid().nullable().optional(),
  health: z.enum(HEALTHS).nullable().optional(),
  progress: z.number().int().min(0).max(100).nullable().optional(),
  dependsOn: z.array(z.string().uuid()).nullable().optional(),
  // Portal sharing (0029): opt this goal into the client-facing portal.
  sharedWithClient: z.boolean().default(false),
});
// z.input so callers can omit fields with defaults (status/priority/tag/checklist).
export type CreateGoalInput = z.input<typeof CreateGoalSchema>;

export const UpdateGoalSchema = CreateGoalSchema.partial();
export type UpdateGoalInput = z.infer<typeof UpdateGoalSchema>;

export const MoveGoalSchema = z.object({
  status: z.string().min(1).max(60),
});
export type MoveGoalInput = z.infer<typeof MoveGoalSchema>;

export const AddResourceSchema = z.object({
  kind: z.enum(RESOURCE_KINDS),
  title: z.string().min(1).max(240),
  url: z.string().max(2048).default(''),
  meta: z.string().max(240).default(''),
});
export type AddResourceInput = z.infer<typeof AddResourceSchema>;
