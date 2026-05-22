import { z } from 'zod';

export const CreateProjectSchema = z.object({
  clientId: z.string().uuid(),
  name: z.string().min(1).max(200),
  code: z.string().max(40).optional(),
  billable: z.boolean().default(true),
  budgetHrs: z.number().int().nonnegative().max(100000).default(120),
  color: z.string().max(20).default('#9333ea'),
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
});
export type UpdateProjectInput = z.infer<typeof UpdateProjectSchema>;
