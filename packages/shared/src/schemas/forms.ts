import { z } from 'zod';

export const FORM_VISIBILITIES = ['private', 'workspace'] as const;
export type FormVisibility = (typeof FORM_VISIBILITIES)[number];

export const FORM_STATUSES = ['active', 'paused'] as const;
export type FormStatus = (typeof FORM_STATUSES)[number];

export const FORM_FIELD_TYPES = [
  'text',
  'email',
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

export const FORM_CAPTCHA_PROVIDERS = ['hcaptcha', 'recaptcha'] as const;
export type FormCaptchaProvider = (typeof FORM_CAPTCHA_PROVIDERS)[number];

export const FormFieldOptionSchema = z.object({
  label: z.string().min(1).max(120),
  value: z.string().min(1).max(120),
});
export type FormFieldOption = z.infer<typeof FormFieldOptionSchema>;

export const FormFieldValidationSchema = z.object({
  minLength: z.number().int().min(0).max(5000).optional(),
  maxLength: z.number().int().min(1).max(5000).optional(),
  pattern: z.string().max(500).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
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
  label: z.string().min(1).max(160),
  type: z.enum(FORM_FIELD_TYPES),
  required: z.boolean().optional().default(false),
  placeholder: z.string().max(200).optional().default(''),
  helpText: z.string().max(400).optional().default(''),
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

export const FormDefinitionSchema = z.object({
  title: z.string().max(160).optional().default(''),
  description: z.string().max(2000).optional().default(''),
  submitLabel: z.string().min(1).max(80).optional().default('Submit'),
  successMessage: z.string().min(1).max(280).optional().default('Thanks, we got your submission.'),
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
  | { ok: true; message: string }
  | { ok: false; errors: Record<string, string> };
