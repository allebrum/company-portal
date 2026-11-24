import type { FormField, FormFieldType, FormFieldValidation, PhoneFormat } from './schemas/forms';
export type { PhoneFormat };

/** Stable React/editor identity. Not the submission key (`field.id`). */
export function newFieldKey(): string {
  return `k_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

/**
 * Letters first, then letters, numbers, underscores, or hyphens.
 * This is the public submission key — keep it a slug so embed selectors and CSVs stay safe.
 */
export const FIELD_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/;

export function fieldIdError(id: string, otherIds: string[]): string | null {
  const trimmed = id.trim();
  if (!trimmed) return 'Enter a field id.';
  if (/\s/.test(id)) return 'Field ids can’t contain spaces.';
  if (!FIELD_ID_PATTERN.test(trimmed)) {
    return 'Use a letter first, then letters, numbers, underscores, or hyphens.';
  }
  if (otherIds.some((other) => other === trimmed)) return 'This id is already used by another field.';
  return null;
}

export function ensureFieldKeys(fields: FormField[]): FormField[] {
  const used = new Set<string>();
  return fields.map((field) => {
    let key = field.key?.trim() || '';
    if (!key || used.has(key)) {
      do {
        key = newFieldKey();
      } while (used.has(key));
    }
    used.add(key);
    return key === field.key ? field : { ...field, key };
  });
}

function remapConditions(
  conditions: FormField['showWhen'] | undefined,
  fromId: string,
  toId: string,
): FormField['showWhen'] | undefined {
  if (!conditions || fromId === toId || !toId) return conditions;
  return conditions.map((c) => (c.fieldId === fromId ? { ...c, fieldId: toId } : c));
}

/**
 * Patch a field looked up by its stable `key`. If the user-editable `id` changes,
 * show-if / required-if conditions that pointed at the old id are remapped so
 * existing rules keep working. Selection by key is unaffected.
 */
export function updateFieldByKey(
  fields: FormField[],
  key: string,
  updater: (field: FormField) => FormField,
): FormField[] {
  const current = fields.find((f) => f.key === key);
  if (!current) return fields;
  const next = updater(current);
  const oldId = current.id;
  const newId = next.id;
  return fields.map((f) => {
    const base = f.key === key ? next : f;
    return {
      ...base,
      showWhen: remapConditions(base.showWhen, oldId, newId) ?? base.showWhen ?? [],
      requiredWhen: remapConditions(base.requiredWhen, oldId, newId) ?? base.requiredWhen ?? [],
    };
  });
}

/** Documents the focus bug: looking up by field.id loses the field the moment the id changes. */
export function findFieldById(fields: FormField[], id: string | null): FormField | undefined {
  return id ? fields.find((f) => f.id === id) : undefined;
}

export function findFieldByKey(fields: FormField[], key: string | null): FormField | undefined {
  return key ? fields.find((f) => f.key === key) : undefined;
}

export function phoneFormatOf(field: Pick<FormField, 'validation'>): PhoneFormat {
  const fmt = field.validation?.phoneFormat;
  return fmt === 'international' || fmt === 'e164' ? fmt : 'us';
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

/** As-you-type US display: (555) 123-4567. A leading country-code 1 is dropped. */
export function formatPhoneUS(raw: string): string {
  let d = digitsOnly(raw);
  if (d.length >= 11 && d.startsWith('1')) d = d.slice(1);
  d = d.slice(0, 10);
  if (d.length === 0) return '';
  if (d.length < 4) return `(${d}`;
  if (d.length < 7) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

export function normalizePhone(raw: string, format: PhoneFormat): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  if (format === 'us') {
    let d = digitsOnly(trimmed);
    if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
    return d.length === 10 ? formatPhoneUS(d) : trimmed;
  }
  if (format === 'e164') {
    let d = digitsOnly(trimmed);
    if (trimmed.trim().startsWith('+')) return `+${d}`;
    if (d.length === 10) return `+1${d}`;
    if (d.length === 11 && d.startsWith('1')) return `+${d}`;
    return d ? `+${d}` : '';
  }
  const d = digitsOnly(trimmed);
  const plus = trimmed.trim().startsWith('+') || d.length > 10;
  return plus ? `+${d}` : d;
}

export function validatePhone(raw: string, format: PhoneFormat): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const d = digitsOnly(trimmed);
  if (format === 'us') {
    const local = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
    if (local.length !== 10) return 'Enter a 10-digit US phone number.';
    return null;
  }
  if (format === 'e164') {
    const e164 = normalizePhone(trimmed, 'e164');
    if (!/^\+[1-9]\d{7,14}$/.test(e164)) return 'Enter a phone number in international format, starting with + and the country code.';
    return null;
  }
  if (d.length < 8 || d.length > 15) return 'Enter a phone number with 8–15 digits.';
  return null;
}

/** Practical email check (not a full RFC parser). */
export const EMAIL_PATTERN =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function validateEmail(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.length > 254 || s.includes('..') || s.startsWith('.') || s.endsWith('.')) {
    return 'Please enter a valid email address.';
  }
  if (!EMAIL_PATTERN.test(s)) return 'Please enter a valid email address.';
  return null;
}

export function validateUrl(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return 'Enter a URL starting with http:// or https://.';
    }
    if (!u.hostname || !u.hostname.includes('.')) return 'Please enter a valid URL.';
    return null;
  } catch {
    return 'Please enter a valid URL.';
  }
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map((p) => Number(p));
  if (!y || !m || !d) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function validateDate(raw: string, min?: string, max?: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (!isValidIsoDate(s)) return 'Enter a valid date.';
  if (min && isValidIsoDate(min) && s < min) return `Date must be on or after ${min}.`;
  if (max && isValidIsoDate(max) && s > max) return `Date must be on or before ${max}.`;
  return null;
}

function nearMultiple(value: number, start: number, step: number): boolean {
  const n = (value - start) / step;
  return Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-8;
}

export function validateNumber(
  raw: unknown,
  validation: FormFieldValidation | undefined,
  required: boolean,
): string | null {
  if (raw === undefined || raw === null || raw === '') {
    return required ? 'This field is required.' : null;
  }
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return 'Please enter a valid number.';
  const min = validation?.min;
  const max = validation?.max;
  const step = validation?.step;
  if (typeof min === 'number' && n < min) return `Must be at least ${min}.`;
  if (typeof max === 'number' && n > max) return `Must be at most ${max}.`;
  if (typeof step === 'number' && step > 0 && !nearMultiple(n, typeof min === 'number' ? min : 0, step)) {
    return `Must be a multiple of ${step}.`;
  }
  return null;
}

export function validateTypedValue(field: FormField, raw: unknown): string | null {
  if (field.type === 'number') return null; // handled separately
  const str = typeof raw === 'string' ? raw.trim() : '';
  if (!str) return null;
  if (field.type === 'email') return validateEmail(str);
  if (field.type === 'phone') return validatePhone(str, phoneFormatOf(field));
  if (field.type === 'url') return validateUrl(str);
  if (field.type === 'date') return validateDate(str, field.validation?.minDate, field.validation?.maxDate);
  return null;
}

export function normalizeTypedValue(field: FormField, raw: unknown): unknown {
  if (raw == null) return field.type === 'number' ? null : '';
  if (field.type === 'phone' && typeof raw === 'string') return normalizePhone(raw, phoneFormatOf(field));
  if (field.type === 'email' && typeof raw === 'string') return raw.trim().toLowerCase();
  if (field.type === 'url' && typeof raw === 'string') return raw.trim();
  if (field.type === 'date' && typeof raw === 'string') return raw.trim();
  return raw;
}

export function defaultAutocomplete(type: FormFieldType, explicit?: string): string | undefined {
  const set = explicit?.trim();
  if (set) return set;
  if (type === 'email') return 'email';
  if (type === 'phone') return 'tel';
  if (type === 'url') return 'url';
  if (type === 'date') return 'off';
  return undefined;
}

export function htmlInputType(type: FormFieldType): string {
  if (type === 'email') return 'email';
  if (type === 'phone') return 'tel';
  if (type === 'url') return 'url';
  if (type === 'date') return 'date';
  if (type === 'number') return 'number';
  return 'text';
}

export type HtmlInputMode = 'email' | 'tel' | 'url' | 'decimal';

export function htmlInputMode(type: FormFieldType): HtmlInputMode | undefined {
  if (type === 'email') return 'email';
  if (type === 'phone') return 'tel';
  if (type === 'url') return 'url';
  if (type === 'number') return 'decimal';
  return undefined;
}

export const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: 'Text',
  email: 'Email',
  phone: 'Phone',
  url: 'URL',
  date: 'Date',
  number: 'Number',
  textarea: 'Long text',
  select: 'Dropdown',
  checkbox: 'Checkboxes',
  radio: 'Multiple choice',
};

export const FIELD_TYPE_GROUPS: { label: string; types: FormFieldType[] }[] = [
  { label: 'Common', types: ['text', 'email', 'phone', 'url', 'date', 'number', 'textarea'] },
  { label: 'Choices', types: ['select', 'radio', 'checkbox'] },
];

export type FieldPreset = {
  id: string;
  label: string;
  fields: Array<Partial<FormField> & { label: string; type: FormFieldType; id: string }>;
};

export const FIELD_PRESETS: FieldPreset[] = [
  {
    id: 'name',
    label: 'Full name',
    fields: [
      {
        id: 'full_name',
        label: 'Full name',
        type: 'text',
        required: true,
        placeholder: 'Jane Doe',
        autocomplete: 'name',
        validation: { minLength: 2 },
      },
    ],
  },
  {
    id: 'email',
    label: 'Email',
    fields: [
      {
        id: 'email',
        label: 'Email',
        type: 'email',
        required: true,
        placeholder: 'you@company.com',
        autocomplete: 'email',
        validation: {},
      },
    ],
  },
  {
    id: 'phone',
    label: 'Phone',
    fields: [
      {
        id: 'phone',
        label: 'Phone number',
        type: 'phone',
        required: false,
        placeholder: '(555) 123-4567',
        autocomplete: 'tel',
        validation: { phoneFormat: 'us' },
      },
    ],
  },
  {
    id: 'address',
    label: 'Address',
    fields: [
      { id: 'street', label: 'Street address', type: 'text', placeholder: '123 Main St', autocomplete: 'address-line1', validation: {} },
      { id: 'city', label: 'City', type: 'text', placeholder: 'Springfield', autocomplete: 'address-level2', validation: {} },
      { id: 'state', label: 'State / region', type: 'text', placeholder: 'CA', autocomplete: 'address-level1', validation: {} },
      { id: 'zip', label: 'ZIP / postal code', type: 'text', placeholder: '94105', autocomplete: 'postal-code', validation: {} },
      { id: 'country', label: 'Country', type: 'text', placeholder: 'United States', autocomplete: 'country-name', validation: {} },
    ],
  },
];

/** Strip leading/trailing underscores without a backtracking regex. */
export function trimUnderscores(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '_') start++;
  while (end > start && value[end - 1] === '_') end--;
  return value.slice(start, end);
}

export function uniqueFieldId(base: string, existing: string[]): string {
  const slug = trimUnderscores(base.slice(0, 200).replace(/[^a-zA-Z0-9_]+/g, '_')) || 'field';
  const safe = /^[a-zA-Z]/.test(slug) ? slug : `f_${slug}`;
  if (!existing.includes(safe)) return safe.slice(0, 80);
  for (let i = 2; i < 1000; i++) {
    const next = `${safe.slice(0, 76)}_${i}`;
    if (!existing.includes(next)) return next;
  }
  return `${safe.slice(0, 60)}_${Date.now().toString(36)}`;
}

export function instantiatePreset(preset: FieldPreset, existing: FormField[]): FormField[] {
  const used = existing.map((f) => f.id);
  return preset.fields.map((partial) => {
    const id = uniqueFieldId(partial.id, used);
    used.push(id);
    return {
      required: false,
      placeholder: '',
      helpText: '',
      autocomplete: '',
      options: [],
      validation: {},
      showWhen: [],
      requiredWhen: [],
      ...partial,
      id,
      key: newFieldKey(),
    } as FormField;
  });
}
