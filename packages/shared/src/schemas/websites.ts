import { z } from 'zod';

export const WEBSITE_STATUSES = ['active', 'trial', 'paused', 'canceled'] as const;
export type WebsiteStatus = (typeof WEBSITE_STATUSES)[number];

export const WEBSITE_BILLING_CYCLES = ['monthly', 'annual', 'quarterly', 'one-time', 'custom'] as const;
export type WebsiteBillingCycle = (typeof WEBSITE_BILLING_CYCLES)[number];

const OptionalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected yyyy-mm-dd date')
  .nullable()
  .optional();

const CredentialsInputSchema = z
  .object({
    username: z.string().max(320).nullable().optional(),
    password: z.string().max(1000).nullable().optional(),
  })
  .optional();

export const CreateWebsiteSchema = z.object({
  name: z.string().min(1).max(160),
  siteUrl: z.string().url().max(2000),
  category: z.string().max(80).optional().default(''),
  status: z.enum(WEBSITE_STATUSES).optional().default('active'),
  billingCycle: z.enum(WEBSITE_BILLING_CYCLES).optional().default('monthly'),
  billingAmountCents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  billingCurrency: z.string().regex(/^[A-Z]{3}$/).optional().default('USD'),
  renewalDate: OptionalDateSchema,
  notes: z.string().max(4000).optional().default(''),
  assignedUserIds: z.array(z.string().uuid()).max(100).optional().default([]),
  credentials: CredentialsInputSchema,
});
export type CreateWebsiteInput = z.input<typeof CreateWebsiteSchema>;

export const UpdateWebsiteSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  siteUrl: z.string().url().max(2000).optional(),
  category: z.string().max(80).optional(),
  status: z.enum(WEBSITE_STATUSES).optional(),
  billingCycle: z.enum(WEBSITE_BILLING_CYCLES).optional(),
  billingAmountCents: z.number().int().min(0).max(1_000_000_000).nullable().optional(),
  billingCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
  renewalDate: OptionalDateSchema,
  notes: z.string().max(4000).optional(),
  assignedUserIds: z.array(z.string().uuid()).max(100).optional(),
  credentials: CredentialsInputSchema,
});
export type UpdateWebsiteInput = z.infer<typeof UpdateWebsiteSchema>;

export type WebsiteRow = {
  id: string;
  name: string;
  siteUrl: string;
  category: string;
  status: WebsiteStatus;
  billingCycle: WebsiteBillingCycle;
  billingAmountCents: number | null;
  billingCurrency: string;
  renewalDate: string | null;
  notes: string;
  assignedUserIds: string[];
  hasCredentialUsername: boolean;
  hasCredentialPassword: boolean;
  credentialsUpdatedAt: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type WebsiteCredentialsRow = {
  websiteId: string;
  username: string | null;
  password: string | null;
  updatedAt: string | null;
};
