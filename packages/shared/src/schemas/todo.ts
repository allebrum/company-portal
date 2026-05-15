import { z } from 'zod';
import { PRIORITIES, TODO_STATUSES } from '../enums';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

export const CreateTodoSchema = z.object({
  title: z.string().min(1).max(280),
  assigneeId: z.string().uuid().nullable().optional(),
  clientId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  goalId: z.string().uuid().nullable().optional(),
  dueDate: isoDate.optional(),
  estimateMin: z.number().int().min(0).max(10_000).default(60),
  priority: z.enum(PRIORITIES).default('medium'),
  tags: z.array(z.string().max(40)).default([]),
  private: z.boolean().default(false),
});
export type CreateTodoInput = z.infer<typeof CreateTodoSchema>;

export const UpdateTodoSchema = CreateTodoSchema.partial().extend({
  status: z.enum(TODO_STATUSES).optional(),
  loggedMin: z.number().int().min(0).max(1_000_000).optional(),
});
export type UpdateTodoInput = z.infer<typeof UpdateTodoSchema>;
