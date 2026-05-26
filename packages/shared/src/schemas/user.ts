import { z } from 'zod';

export const InviteUserSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  groupIds: z.array(z.string().uuid()).default([]),
  // `sendInvite` controls whether the new teammate receives a transactional
  // "set your password" email (default true). Set false for Google-only
  // teammates who only sign in via the OAuth flow.
  sendInvite: z.boolean().default(true),
  billable: z.number().nonnegative().max(10000).default(150),
  color: z.string().max(20).optional(),
});
export type InviteUserInput = z.infer<typeof InviteUserSchema>;

export const UpdateUserSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().optional(),
  groupIds: z.array(z.string().uuid()).optional(),
  billable: z.number().nonnegative().max(10000).optional(),
  color: z.string().max(20).optional(),
  initials: z.string().max(4).optional(),
  password: z.string().min(8).max(200).optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
