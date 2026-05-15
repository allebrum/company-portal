import { z } from 'zod';
import { ROLES } from '../enums';

export const InviteUserSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  role: z.enum(ROLES).default('member'),
  password: z.string().min(8).max(200).optional(),
  billable: z.number().nonnegative().max(10000).default(150),
  color: z.string().max(20).optional(),
});
export type InviteUserInput = z.infer<typeof InviteUserSchema>;

export const UpdateUserSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  role: z.enum(ROLES).optional(),
  billable: z.number().nonnegative().max(10000).optional(),
  color: z.string().max(20).optional(),
  initials: z.string().max(4).optional(),
  password: z.string().min(8).max(200).optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
