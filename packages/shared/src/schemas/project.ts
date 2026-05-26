import { z } from 'zod';
import { STATUS_TONES } from '../enums';
import { SpaceBlockSchema, SpaceFileSchema } from './space';

// One column in a project's custom status workflow.
export const ProjectStatusSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  tone: z.enum(STATUS_TONES),
});
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const CreateProjectSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1).max(200),
  code: z.string().max(40).optional(),
  billable: z.boolean().default(true),
  budgetHrs: z.number().int().nonnegative().max(100000).default(120),
  color: z.string().max(20).default('#9333ea'),
  statuses: z.array(ProjectStatusSchema).max(12).nullable().optional(),
});
// z.input so callers can create with just { clientId, name } (rest default).
export type CreateProjectInput = z.input<typeof CreateProjectSchema>;

export const UpdateProjectSchema = z.object({
  clientId: z.string().uuid().optional(),
  name: z.string().min(1).max(200).optional(),
  code: z.string().max(40).optional(),
  billable: z.boolean().optional(),
  budgetHrs: z.number().int().nonnegative().max(100000).optional(),
  color: z.string().max(20).optional(),
  statuses: z.array(ProjectStatusSchema).max(12).nullable().optional(),
  // See client.ts — same Space-canvas full-replace semantics.
  spaceBlocks: z.array(SpaceBlockSchema).max(2000).optional(),
  spaceFiles: z.array(SpaceFileSchema).max(500).optional(),
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
