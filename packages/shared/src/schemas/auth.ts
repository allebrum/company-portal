import { z } from 'zod';
import { ROLES } from '../enums';

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const SessionUserSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ROLES),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;
