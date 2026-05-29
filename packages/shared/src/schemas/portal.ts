import { z } from 'zod';

/**
 * F23 client portal — shared zod schemas for the staff-side contact
 * management surface and the public-portal request/exchange flow.
 *
 * Slug + reserved-slug validation lives in `client.ts` so it can be
 * reused by the client PATCH route.
 */

export const CONTACT_ROLES = ['primary', 'viewer'] as const;
export type ContactRole = (typeof CONTACT_ROLES)[number];

export const InviteContactSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email().max(254),
  role: z.enum(CONTACT_ROLES).default('viewer'),
});
export type InviteContactInput = z.infer<typeof InviteContactSchema>;

export const UpdateContactSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  role: z.enum(CONTACT_ROLES).optional(),
});
export type UpdateContactInput = z.infer<typeof UpdateContactSchema>;

/** Public-portal "send me a magic link" request body. */
export const PortalRequestAccessSchema = z.object({
  slug: z.string().min(1).max(60),
  email: z.string().email().max(254),
});
export type PortalRequestAccessInput = z.infer<typeof PortalRequestAccessSchema>;

/** Public-portal token exchange (called from the magic-link URL). */
export const PortalExchangeSchema = z.object({
  slug: z.string().min(1).max(60),
  token: z.string().min(1).max(200),
});
export type PortalExchangeInput = z.infer<typeof PortalExchangeSchema>;
