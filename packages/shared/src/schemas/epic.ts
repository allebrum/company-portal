import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const CreateEpicSchema = z.object({
  projectId: z.string().uuid(),
  clientId: z.string().uuid(),
  title: z.string().min(1).max(200),
  color: z.string().max(20).default('#9333ea'),
  icon: z.string().max(40).default('layers'),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
});
export type CreateEpicInput = z.input<typeof CreateEpicSchema>;

export const UpdateEpicSchema = CreateEpicSchema.partial();
export type UpdateEpicInput = z.infer<typeof UpdateEpicSchema>;
