import { z } from 'zod';

/** Public auth config the login page reads (no secrets). */
export type AuthConfig = {
  passwordLoginEnabled: boolean;
  googleLoginEnabled: boolean;
};

export const UpdateAppSettingsSchema = z.object({
  passwordLoginEnabled: z.boolean().optional(),
  googleLoginEnabled: z.boolean().optional(),
  allowedEmailDomains: z.array(z.string().min(1).max(253)).max(50).optional(),
  bookkeeperEmail: z.string().email().nullable().optional(),
  sendToBookkeeperOn: z.enum(['never', 'pay_period_closed']).optional(),
});
export type UpdateAppSettingsInput = z.infer<typeof UpdateAppSettingsSchema>;

export type AppSettings = {
  id: string;
  passwordLoginEnabled: boolean;
  googleLoginEnabled: boolean;
  allowedEmailDomains: string[];
  bookkeeperEmail: string | null;
  sendToBookkeeperOn: 'never' | 'pay_period_closed';
  updatedAt: string;
};
