import { z } from 'zod';

/** Public auth config the login page reads (no secrets). Carries branding
 *  + legal-URL data so the unauthenticated login surface can render an
 *  on-brand experience without a second fetch. */
export type AuthConfig = {
  passwordLoginEnabled: boolean;
  googleLoginEnabled: boolean;
  /** External URLs admins paste in Settings → Branding. The login footer
   *  shows each link only when its URL is set. */
  termsUrl: string | null;
  privacyUrl: string | null;
  /** Branding controls — applied to the login page + sidebar. */
  portalName: string;
  brandPrimaryColor: string;
  brandLogoDataUrl: string | null;
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
  // External URLs for Terms / Privacy. Pass null to clear (hides the
  // login-footer link). Validated as URLs because the login page builds
  // an <a href> straight from them.
  termsUrl: z.string().url().max(2000).nullable().optional(),
  privacyUrl: z.string().url().max(2000).nullable().optional(),
  // Branding — single primary color (#rrggbb), short portal name (used in
  // the sidebar + login title), and an optional logo image stored as a
  // base64 data URL. The 800k cap is the server-side guard; the UI caps
  // user uploads at ~500k pre-encoding.
  portalName: z.string().min(1).max(60).optional(),
  brandPrimaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Hex color #RRGGBB').optional(),
  brandLogoDataUrl: z.string().max(800_000).nullable().optional(),
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
  termsUrl: string | null;
  privacyUrl: string | null;
  portalName: string;
  brandPrimaryColor: string;
  brandLogoDataUrl: string | null;
  updatedAt: string;
};
