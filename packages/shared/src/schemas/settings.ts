import { z } from 'zod';

/** Public auth config the login page reads (no secrets). */
export type AuthConfig = {
  passwordLoginEnabled: boolean;
  googleLoginEnabled: boolean;
  /** Whether the workspace admin has published a Terms of Service / Privacy
   *  Policy. The login footer shows the corresponding links only when true. */
  termsConfigured: boolean;
  privacyConfigured: boolean;
};

export const UpdateAppSettingsSchema = z.object({
  passwordLoginEnabled: z.boolean().optional(),
  googleLoginEnabled: z.boolean().optional(),
  allowedEmailDomains: z.array(z.string().min(1).max(253)).max(50).optional(),
  bookkeeperEmail: z.string().email().nullable().optional(),
  sendToBookkeeperOn: z.enum(['never', 'pay_period_closed']).optional(),
  // The user whose connected Gmail is used to send mail with no session
  // (password reset). Pass null to clear. Validated by the route to ensure
  // the chosen user actually has a `google_gmail` oauth_tokens row.
  systemSenderUserId: z.string().uuid().nullable().optional(),
  // Markdown-formatted policy copy surfaced on the public /terms and
  // /privacy pages. Pass null to clear (hides the login-footer link).
  termsOfService: z.string().max(65535).nullable().optional(),
  privacyPolicy: z.string().max(65535).nullable().optional(),
});
export type UpdateAppSettingsInput = z.infer<typeof UpdateAppSettingsSchema>;

export type AppSettings = {
  id: string;
  passwordLoginEnabled: boolean;
  googleLoginEnabled: boolean;
  allowedEmailDomains: string[];
  bookkeeperEmail: string | null;
  sendToBookkeeperOn: 'never' | 'pay_period_closed';
  systemSenderUserId: string | null;
  termsOfService: string | null;
  privacyPolicy: string | null;
  updatedAt: string;
};
