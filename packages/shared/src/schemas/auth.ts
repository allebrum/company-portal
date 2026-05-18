import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
});
export type LoginInput = z.infer<typeof LoginSchema>;

// Session now stores only the user id; permissions are resolved per-request
// from group membership + overrides.
export const SessionUserSchema = z.object({
  userId: z.string().uuid(),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;
