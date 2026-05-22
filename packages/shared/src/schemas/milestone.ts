import { z } from 'zod';
import { MILESTONE_KINDS } from '../enums';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const CreateMilestoneSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1).max(200),
  date: isoDate,
  kind: z.enum(MILESTONE_KINDS).default('release'),
  color: z.string().max(20).default('#9333ea'),
});
export type CreateMilestoneInput = z.input<typeof CreateMilestoneSchema>;

export const UpdateMilestoneSchema = CreateMilestoneSchema.partial();
export type UpdateMilestoneInput = z.infer<typeof UpdateMilestoneSchema>;
