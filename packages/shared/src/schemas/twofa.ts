import { z } from 'zod';

// 6-digit TOTP or a recovery code (xxxx-xxxx style, letters/digits/dash).
export const TotpVerifySchema = z.object({
  code: z.string().min(6).max(40),
});
export type TotpVerifyInput = z.infer<typeof TotpVerifySchema>;

export const TotpEnableSchema = z.object({
  code: z.string().min(6).max(10),
});
export type TotpEnableInput = z.infer<typeof TotpEnableSchema>;

export const RenameCredentialSchema = z.object({
  name: z.string().min(1).max(60),
});

// WebAuthn ceremony payloads are validated by @simplewebauthn on the server;
// accept the browser's response object as-is here.
export const WebAuthnResponseSchema = z.object({
  response: z.unknown(),
});
export type WebAuthnResponseInput = z.infer<typeof WebAuthnResponseSchema>;

export type TwoFactorStatus = {
  required: boolean; // enforced by a group the user belongs to
  totpEnabled: boolean;
  passkeys: { id: string; name: string; createdAt: string }[];
};

// Returned by GET /auth/2fa/challenge during the second login step.
export type TwoFactorChallenge = {
  pending: boolean;
  totp: boolean;
  passkey: boolean;
};
