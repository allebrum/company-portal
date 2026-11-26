import { z } from 'zod';

export const FORM_VISIBILITIES = ['private', 'workspace'] as const;
export type FormVisibility = (typeof FORM_VISIBILITIES)[number];

export const FORM_STATUSES = ['active', 'paused'] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

export const FORM_FIELD_TYPES = [
  'text',
  'email',
  'phone',
  'url',
  'date',
  'number',
  'textarea',
  'select',
  'checkbox',
  'radio',
] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export const FORM_CONDITION_OPERATORS = [
  'equals',
  'not_equals',
  'includes',
  'is_truthy',
  'is_falsy',
] as const;
export type FormConditionOperator = (typeof FORM_CONDITION_OPERATORS)[number];

export const FORM_CAPTCHA_PROVIDERS = ['hcaptcha', 'recaptcha', 'turnstile'] as const;
export type FormCaptchaProvider = (typeof FORM_CAPTCHA_PROVIDERS)[number];

export const FormFieldOptionSchema = z.object({
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(120),
});
export type FormFieldOption = z.infer<typeof FormFieldOptionSchema>;

export const PHONE_FORMATS = ['us', 'international', 'e164'] as const;
export type PhoneFormat = (typeof PHONE_FORMATS)[number];

export const FormFieldValidationSchema = z.object({
  minLength: z.number().int().min(0).max(5000).optional(),
  maxLength: z.number().int().min(1).max(5000).optional(),
  pattern: z.string().max(500).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
  /** Phone formatting: US (default), loose international, or E.164. */
  phoneFormat: z.enum(PHONE_FORMATS).optional(),
  /** Inclusive YYYY-MM-DD bounds for `date` fields. */
  minDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
  maxDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional(),
});
export type FormFieldValidation = z.infer<typeof FormFieldValidationSchema>;

export const FormFieldConditionSchema = z.object({
  fieldId: z.string().min(1).max(80),
  operator: z.enum(FORM_CONDITION_OPERATORS),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type FormFieldCondition = z.infer<typeof FormFieldConditionSchema>;

export const FormFieldSchema = z.object({
  id: z.string().min(1).max(80),
  /**
   * Stable editor identity, separate from the user-editable submission `id`.
   * Optional so existing saved forms (which have no key) still parse; the
   * builder assigns one when a form is opened.
   */
  key: z.string().min(1).max(80).optional(),
  label: z.string().min(1).max(160),
  type: z.enum(FORM_FIELD_TYPES),
  required: z.boolean().optional().default(false),
  placeholder: z.string().max(200).optional().default(''),
  helpText: z.string().max(400).optional().default(''),
  autocomplete: z.string().max(80).optional().default(''),
  options: z.array(FormFieldOptionSchema).max(200).optional().default([]),
  validation: FormFieldValidationSchema.optional().default({}),
  showWhen: z.array(FormFieldConditionSchema).max(20).optional().default([]),
  requiredWhen: z.array(FormFieldConditionSchema).max(20).optional().default([]),
});
export type FormField = z.infer<typeof FormFieldSchema>;

export const FormSecuritySchema = z.object({
  allowedOrigins: z.array(z.string().url().max(2000)).max(200).optional().default([]),
  allowedPathPrefixes: z.array(z.string().max(400)).max(200).optional().default([]),
  requireCaptcha: z.boolean().optional().default(false),
  captchaProvider: z.enum(FORM_CAPTCHA_PROVIDERS).nullable().optional().default(null),
  honeypotFieldName: z.string().min(1).max(80).optional().default('company_website'),
});
export type FormSecurity = z.infer<typeof FormSecuritySchema>;

/**
 * New-submission notifications (per form).
 *  - off:       no email.
 *  - immediate: one email per accepted submission.
 *  - digest:    one daily summary email (sent each morning, workspace time).
 * Recipients = workspace users (by id) + extra email addresses. When both
 * lists are empty the form owner is notified.
 */
export const FORM_NOTIFY_MODES = ['off', 'immediate', 'digest'] as const;
export type FormNotifyMode = (typeof FORM_NOTIFY_MODES)[number];

export const FormNotificationsSchema = z.object({
  mode: z.enum(FORM_NOTIFY_MODES).optional().default('immediate'),
  userIds: z.array(z.string().uuid()).max(50).optional().default([]),
  emails: z.array(z.string().trim().email().max(320)).max(50).optional().default([]),
});
export type FormNotifications = z.infer<typeof FormNotificationsSchema>;

export const DEFAULT_FORM_NOTIFICATIONS: FormNotifications = { mode: 'immediate', userIds: [], emails: [] };

/**
 * Per-form Cloudflare Turnstile keys. Turnstile widgets carry a hostname
 * allowlist, so forms embedded on different client sites usually need their
 * own widget. Write-only secret:
 *   - `secret` omitted → keep the stored secret
 *   - `secret` null / '' → clear it
 *   - `secret` string → encrypt + store (never returned to the client)
 * Leave both blank to fall back to the server-wide TURNSTILE_* env keys.
 */
export const FormTurnstileInputSchema = z.object({
  siteKey: z.string().trim().max(200).nullable().optional(),
  secret: z.string().trim().max(400).nullable().optional(),
});
export type FormTurnstileInput = z.infer<typeof FormTurnstileInputSchema>;

export const DEFAULT_RESET_LABEL = 'Submit another response';
export const DEFAULT_RESUBMIT_WINDOW_HOURS = 24;
export const DEFAULT_MAX_SUBMISSIONS_PER_IP_PER_HOUR = 10;
export const DEFAULT_MAX_SUBMISSIONS_PER_HOUR = 200;
export const FORM_ALREADY_SUBMITTED_MESSAGE = "You've already submitted this form.";
export const FORM_RATE_LIMITED_MESSAGE = 'Too many submissions. Please try again later.';

/** Accept only absolute http(s) URLs — never javascript:, data:, or relative paths. */
export function isSafeRedirectUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const OptionalRedirectUrl = z.preprocess((v) => {
  if (v == null) return undefined;
  if (typeof v === 'string' && v.trim() === '') return undefined;
  return typeof v === 'string' ? v.trim() : v;
}, z
  .string()
  .max(2000)
  .url()
  .refine(isSafeRedirectUrl, 'Must start with http:// or https://')
  .optional());

const OptionalResetLabel = z.preprocess((v) => {
  if (typeof v === 'string' && v.trim() === '') return undefined;
  return v;
}, z.string().min(1).max(80).optional().default(DEFAULT_RESET_LABEL));

export const FormDefinitionSchema = z.object({
  title: z.string().max(160).optional().default(''),
  description: z.string().max(2000).optional().default(''),
  submitLabel: z.string().min(1).max(80).optional().default('Submit'),
  successMessage: z.string().min(1).max(280).optional().default('Thanks, we got your submission.'),
  /**
   * If set, the embed navigates the top window here after a successful submit
   * instead of showing the in-place confirmation panel.
   */
  redirectUrl: OptionalRedirectUrl,
  /**
   * When true (default), the confirmation panel offers “Submit another response”.
   * When false, that link is hidden and the server allows one submission per
   * visitor per `resubmitWindowHours` (default 24h) — useful for email signups.
   */
  allowAnotherSubmission: z.boolean().optional().default(true),
  resetLabel: OptionalResetLabel,
  resubmitWindowHours: z.number().int().min(1).max(8760).optional().default(DEFAULT_RESUBMIT_WINDOW_HOURS),
  /** Per-visitor cap on accepted submissions for this form. Burst of 5 / 10 min also applies. */
  maxSubmissionsPerIpPerHour: z.number().int().min(1).max(100).optional().default(DEFAULT_MAX_SUBMISSIONS_PER_IP_PER_HOUR),
  /** Form-wide cap on accepted submissions (all visitors) per hour. */
  maxSubmissionsPerHour: z.number().int().min(10).max(10000).optional().default(DEFAULT_MAX_SUBMISSIONS_PER_HOUR),
  fields: z.array(FormFieldSchema).min(1).max(100),
  security: FormSecuritySchema.optional().default({}),
});
export type FormDefinition = z.infer<typeof FormDefinitionSchema>;

export const CreateFormSchema = z.object({
  name: z.string().min(1).max(140),
  description: z.string().max(2000).optional().default(''),
  clientId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  visibility: z.enum(FORM_VISIBILITIES).optional().default('workspace'),
  status: z.enum(FORM_STATUSES).optional().default('active'),
  definition: FormDefinitionSchema,
  notifications: FormNotificationsSchema.optional(),
  turnstile: FormTurnstileInputSchema.optional(),
});
export type CreateFormInput = z.input<typeof CreateFormSchema>;

export const UpdateFormSchema = z.object({
  name: z.string().min(1).max(140).optional(),
  description: z.string().max(2000).optional(),
  clientId: z.string().uuid().nullable().optional(),
  projectId: z.string().uuid().nullable().optional(),
  visibility: z.enum(FORM_VISIBILITIES).optional(),
  status: z.enum(FORM_STATUSES).optional(),
  definition: FormDefinitionSchema.optional(),
  notifications: FormNotificationsSchema.optional(),
  turnstile: FormTurnstileInputSchema.optional(),
});
export type UpdateFormInput = z.infer<typeof UpdateFormSchema>;

export const FORM_EVENT_TYPES = ['view', 'interact', 'submit'] as const;
export type FormEventType = (typeof FORM_EVENT_TYPES)[number];

export const TrackFormEventSchema = z.object({
  sessionId: z.string().min(8).max(120),
  type: z.enum(FORM_EVENT_TYPES),
  path: z.string().max(2000).optional().nullable(),
});
export type TrackFormEventInput = z.infer<typeof TrackFormEventSchema>;

export const PublicFormSubmitSchema = z.object({
  sessionId: z.string().min(8).max(120),
  answers: z.record(z.unknown()),
  captchaToken: z.string().max(4096).optional().nullable(),
  honey: z.string().max(400).optional().nullable(),
});
export type PublicFormSubmitInput = z.infer<typeof PublicFormSubmitSchema>;

export type FormRow = {
  id: string;
  ownerUserId: string;
  name: string;
  description: string;
  clientId: string | null;
  projectId: string | null;
  visibility: FormVisibility;
  status: FormStatus;
  definition: FormDefinition;
  views: number;
  interactions: number;
  submissions: number;
  /** ISO timestamp of the newest submission, null when none. */
  lastSubmissionAt: string | null;
  notifications: FormNotifications;
  /** Per-form Turnstile config. The secret itself is never sent. */
  turnstile: { siteKey: string | null; hasSecret: boolean };
  embedToken: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type FormSubmissionRow = {
  id: string;
  formId: string;
  sessionId: string | null;
  submittedAt: string;
  answers: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  referer: string | null;
};

export type PublicFormPayload = {
  id: string;
  name: string;
  description: string;
  definition: FormDefinition;
  security: {
    captchaProvider: FormCaptchaProvider | null;
    captchaSiteKey: string | null;
    honeypotFieldName: string;
  };
};

export type PublicFormSubmitResult =
  | { ok: true; message: string; alreadySubmitted?: boolean }
  | { ok: false; errors: Record<string, string>; status?: 400 | 429 };

/** GET /api/forms/config — what the form settings UI needs to warn about. */
export type FormsConfig = {
  /** Workspace system sender (Settings → Email) is set AND has Gmail connected. */
  senderConnected: boolean;
  senderName: string | null;
  /** Server-wide captcha keys present (env). */
  captcha: {
    hcaptcha: boolean;
    recaptcha: boolean;
    /** Workspace Turnstile integration is connected (Admin → Integrations). */
    turnstile: boolean;
  };
  /** Credentials vault keyset works — required to store a per-form Turnstile secret. */
  secretStorageReady: boolean;
};
