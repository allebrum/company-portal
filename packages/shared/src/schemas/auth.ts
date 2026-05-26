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

// ---- Password reset / accept-invite ----
//
// Tokens are opaque base64url strings from `crypto.randomBytes(32)` — the
// API SHA-256s them and looks the hash up in `auth_tokens`. We accept up
// to 256 chars to be safe against encoding variations.
export const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z.object({
  token: z.string().min(20).max(256),
  password: z.string().min(8).max(200),
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

// AcceptInviteSchema is identical in shape — kept separate so callers and
// rate-limit buckets are explicit about which flow they're in.
export const AcceptInviteSchema = ResetPasswordSchema;
export type AcceptInviteInput = z.infer<typeof AcceptInviteSchema>;
