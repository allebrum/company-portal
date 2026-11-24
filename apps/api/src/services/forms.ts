import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, count, desc, eq, inArray, isNull, max, or, sql } from 'drizzle-orm';
import type {
  CreateFormInput,
  FormCaptchaProvider,
  FormDefinition,
  FormEventType,
  FormField,
  FormsConfig,
  FormTurnstileInput,
  FormFieldCondition,
  FormRow,
  FormSecurity,
  FormSubmissionRow,
  PublicFormPayload,
  PublicFormSubmitInput,
  PublicFormSubmitResult,
  TrackFormEventInput,
  UpdateFormInput,
} from '@allebrum/shared';
import { db } from '../db/client.js';
import {
  clients,
  formEvents,
  forms,
  formSubmissions,
  projects,
  type Form,
  type FormSubmission,
} from '../db/schema.js';
import { env } from '../env.js';
import { HttpError } from '../middleware/errorHandler.js';
import { tenantEq, stampTenant } from '../tenancy/scope.js';
import { currentTenantId } from '../tenancy/context.js';
import { appendActivity } from './activity.js';
import { loadKeyset } from './credentials.js';
import { notifyNewSubmission, senderStatus } from './formNotifications.js';
import { resolveNotifications } from './formNotifyRules.js';
import { resolveCaptchaSiteKey, TURNSTILE_SECRET_FIELD, verifyCaptcha } from './formCaptcha.js';
import { getTurnstileStatus, getWorkspaceTurnstileKeys } from './turnstile.js';
import { encryptField } from '../lib/crypto.js';

type ScopeLink = { clientId: string | null; projectId: string | null };

type TokenPayload = {
  v: 1;
  formId: string;
  tenantId: string;
};

type TokenHeader = {
  alg: 'HS256';
  typ: 'JWT';
  kid: 'forms-v1';
};

type RowStats = {
  views?: number;
  interactions?: number;
  submissions?: number;
  lastSubmissionAt?: string | null;
};


type PublicRequestContext = {
  origin: string | null;
  referer: string | null;
};

function asFormDefinition(value: unknown): FormDefinition {
  return value as FormDefinition;
}

function asFormSecurity(definition: FormDefinition): FormSecurity {
  return {
    allowedOrigins: definition.security?.allowedOrigins ?? [],
    allowedPathPrefixes: definition.security?.allowedPathPrefixes ?? [],
    requireCaptcha: definition.security?.requireCaptcha ?? false,
    captchaProvider: definition.security?.captchaProvider ?? null,
    honeypotFieldName: definition.security?.honeypotFieldName ?? 'company_website',
  };
}

function asComparableValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join('|');
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (value == null) return '';
  return String(value).trim();
}

function evaluateCondition(condition: FormFieldCondition, answers: Record<string, unknown>): boolean {
  const left = answers[condition.fieldId];
  const right = condition.value;

  switch (condition.operator) {
    case 'is_truthy':
      if (Array.isArray(left)) return left.length > 0;
      if (typeof left === 'string') return left.trim().length > 0;
      return !!left;
    case 'is_falsy':
      if (Array.isArray(left)) return left.length === 0;
      if (typeof left === 'string') return left.trim().length === 0;
      return !left;
    case 'includes': {
      if (Array.isArray(left)) return left.map((v) => String(v)).includes(String(right ?? ''));
      return asComparableValue(left).includes(String(right ?? ''));
    }
    case 'not_equals':
      return asComparableValue(left) !== asComparableValue(right);
    case 'equals':
    default:
      return asComparableValue(left) === asComparableValue(right);
  }
}

function evaluateConditions(conditions: FormFieldCondition[] | undefined, answers: Record<string, unknown>): boolean {
  if (!conditions || conditions.length === 0) return false;
  return conditions.every((c) => evaluateCondition(c, answers));
}

function fieldIsVisible(field: FormField, answers: Record<string, unknown>): boolean {
  if (!field.showWhen || field.showWhen.length === 0) return true;
  return evaluateConditions(field.showWhen, answers);
}

function fieldIsRequired(field: FormField, answers: Record<string, unknown>): boolean {
  return !!field.required || evaluateConditions(field.requiredWhen, answers);
}

function hostFromOriginOrReferer(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function pathFromReferer(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).pathname;
  } catch {
    return null;
  }
}

function ensureAllowedEmbedContext(args: {
  security: FormSecurity;
  origin: string | null;
  referer: string | null;
}): void {
  const allowedOrigins = args.security.allowedOrigins;
  const allowedPathPrefixes = args.security.allowedPathPrefixes;
  const requestOrigin = hostFromOriginOrReferer(args.origin) ?? hostFromOriginOrReferer(args.referer);

  if (allowedOrigins.length > 0) {
    if (!requestOrigin || !allowedOrigins.includes(requestOrigin)) {
      throw new HttpError(403, 'form_origin_not_allowed');
    }
  }

  if (allowedPathPrefixes.length > 0) {
    const refPath = pathFromReferer(args.referer);
    if (!refPath || !allowedPathPrefixes.some((p) => refPath.startsWith(p))) {
      throw new HttpError(403, 'form_path_not_allowed');
    }
  }
}

function embedSecret(): string {
  return env.FORMS_EMBED_SECRET?.trim() || env.SESSION_SECRET;
}

function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function signRawPayload(rawPayload: string): string {
  return createHmac('sha256', embedSecret()).update(rawPayload).digest('base64url');
}

function encodeToken(payload: TokenPayload): string {
  const header: TokenHeader = { alg: 'HS256', typ: 'JWT', kid: 'forms-v1' };
  const rawHeader = b64urlJson(header);
  const rawPayload = b64urlJson(payload);
  const signingInput = `${rawHeader}.${rawPayload}`;
  const signature = signRawPayload(signingInput);
  return `${signingInput}.${signature}`;
}

function decodeToken(token: string): TokenPayload {
  const [rawHeader, rawPayload, signature] = token.split('.');
  if (!rawHeader || !rawPayload || !signature) {
    throw new HttpError(400, 'form_token_invalid');
  }

  let header: unknown;
  try {
    header = JSON.parse(Buffer.from(rawHeader, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(400, 'form_token_invalid');
  }
  if (
    !header ||
    typeof header !== 'object' ||
    (header as { alg?: unknown }).alg !== 'HS256' ||
    (header as { typ?: unknown }).typ !== 'JWT'
  ) {
    throw new HttpError(400, 'form_token_invalid');
  }

  const expected = signRawPayload(`${rawHeader}.${rawPayload}`);
  const gotBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (gotBuf.length !== expBuf.length || !timingSafeEqual(gotBuf, expBuf)) {
    throw new HttpError(400, 'form_token_invalid');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(400, 'form_token_invalid');
  }

  if (
    !payload ||
    typeof payload !== 'object' ||
    (payload as { v?: unknown }).v !== 1 ||
    typeof (payload as { formId?: unknown }).formId !== 'string' ||
    typeof (payload as { tenantId?: unknown }).tenantId !== 'string'
  ) {
    throw new HttpError(400, 'form_token_invalid');
  }

  return payload as TokenPayload;
}

function rowToRow(row: Form, stats?: RowStats): FormRow {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    name: row.name,
    description: row.description,
    clientId: row.clientId,
    projectId: row.projectId,
    visibility: row.visibility as FormRow['visibility'],
    status: row.status as FormRow['status'],
    definition: asFormDefinition(row.definition),
    views: Number(stats?.views ?? 0),
    interactions: Number(stats?.interactions ?? 0),
    submissions: Number(stats?.submissions ?? 0),
    lastSubmissionAt: stats?.lastSubmissionAt ?? null,
    notifications: resolveNotifications(row.notifications),
    turnstile: { siteKey: row.turnstileSiteKey ?? null, hasSecret: !!row.turnstileSecretEnc },
    embedToken: encodeToken({ v: 1, formId: row.id, tenantId: row.tenantId }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}

function submissionToRow(row: FormSubmission): FormSubmissionRow {
  return {
    id: row.id,
    formId: row.formId,
    sessionId: row.sessionId,
    submittedAt: row.submittedAt,
    answers: (row.answers ?? {}) as Record<string, unknown>,
    ip: row.ip,
    userAgent: row.userAgent,
    referer: row.referer,
  };
}

async function resolveScopeLink(args: ScopeLink): Promise<ScopeLink> {
  if (args.projectId) {
    const [project] = await db
      .select({ id: projects.id, clientId: projects.clientId })
      .from(projects)
      .where(and(tenantEq(projects.tenantId), eq(projects.id, args.projectId)))
      .limit(1);
    if (!project) throw new HttpError(400, 'form_project_not_found');
    if (args.clientId && args.clientId !== project.clientId) {
      throw new HttpError(400, 'form_project_client_mismatch');
    }
    return { clientId: project.clientId, projectId: project.id };
  }

  if (args.clientId) {
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(tenantEq(clients.tenantId), eq(clients.id, args.clientId)))
      .limit(1);
    if (!client) throw new HttpError(400, 'form_client_not_found');
  }

  return { clientId: args.clientId, projectId: null };
}

export async function listVisible(args: {
  viewerId: string;
  clientId?: string;
  projectId?: string;
}): Promise<FormRow[]> {
  const filters = [
    tenantEq(forms.tenantId),
    isNull(forms.archivedAt),
    or(eq(forms.ownerUserId, args.viewerId), eq(forms.visibility, 'workspace')),
  ];
  if (args.clientId) filters.push(eq(forms.clientId, args.clientId));
  if (args.projectId) filters.push(eq(forms.projectId, args.projectId));

  const rows = await db
    .select()
    .from(forms)
    .where(and(...filters))
    .orderBy(desc(forms.createdAt));
  if (rows.length === 0) return [];

  const formIds = rows.map((r) => r.id);

  const eventStatsRows = await db
    .select({
      formId: formEvents.formId,
      eventType: formEvents.eventType,
      total: count(formEvents.id),
      uniqueSessions: sql<number>`count(distinct ${formEvents.sessionId})`,
    })
    .from(formEvents)
    .where(inArray(formEvents.formId, formIds))
    .groupBy(formEvents.formId, formEvents.eventType);

  const submissionStatsRows = await db
    .select({
      formId: formSubmissions.formId,
      total: count(formSubmissions.id),
      last: max(formSubmissions.submittedAt),
    })
    .from(formSubmissions)
    .where(inArray(formSubmissions.formId, formIds))
    .groupBy(formSubmissions.formId);

  const statsByForm = new Map<string, RowStats>();
  for (const row of eventStatsRows) {
    const current = statsByForm.get(row.formId) ?? {};
    const type = row.eventType as FormEventType;
    if (type === 'view') current.views = Number(row.uniqueSessions ?? row.total ?? 0);
    if (type === 'interact') current.interactions = Number(row.total ?? 0);
    statsByForm.set(row.formId, current);
  }
  for (const row of submissionStatsRows) {
    const current = statsByForm.get(row.formId) ?? {};
    current.submissions = Number(row.total ?? 0);
    current.lastSubmissionAt = row.last ?? null;
    statsByForm.set(row.formId, current);
  }

  return rows.map((row) => rowToRow(row, statsByForm.get(row.id)));
}

async function getOwned(id: string, ownerUserId: string): Promise<Form | null> {
  const [row] = await db
    .select()
    .from(forms)
    .where(and(tenantEq(forms.tenantId), eq(forms.id, id), eq(forms.ownerUserId, ownerUserId), isNull(forms.archivedAt)))
    .limit(1);
  return row ?? null;
}

async function getForViewer(id: string, viewerId: string): Promise<Form | null> {
  const [row] = await db
    .select()
    .from(forms)
    .where(
      and(
        tenantEq(forms.tenantId),
        eq(forms.id, id),
        isNull(forms.archivedAt),
        or(eq(forms.ownerUserId, viewerId), eq(forms.visibility, 'workspace')),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getRowForViewer(args: { id: string; viewerId: string }): Promise<FormRow> {
  const row = await getForViewer(args.id, args.viewerId);
  if (!row) throw new HttpError(404, 'form_not_found');
  return rowToRow(row);
}

/**
 * Map the write-only Turnstile input onto columns. The secret is encrypted
 * with the credentials-vault keyset (bound to tenant + form id + field) and
 * never leaves the server. Site key and secret must be set together.
 */
function turnstileColumns(args: {
  id: string;
  existing: Form | null;
  input: FormTurnstileInput | undefined;
}): { turnstileSiteKey?: string | null; turnstileSecretEnc?: string | null } {
  if (!args.input) return {};
  const out: { turnstileSiteKey?: string | null; turnstileSecretEnc?: string | null } = {};
  const siteKeyGiven = args.input.siteKey !== undefined;
  const nextSiteKey = siteKeyGiven ? (args.input.siteKey?.trim() || null) : (args.existing?.turnstileSiteKey ?? null);
  if (siteKeyGiven) out.turnstileSiteKey = nextSiteKey;

  let hasSecret = !!args.existing?.turnstileSecretEnc;
  if (args.input.secret !== undefined) {
    const secret = args.input.secret?.trim() || '';
    if (!secret) {
      out.turnstileSecretEnc = null;
      hasSecret = false;
    } else {
      const { keyset } = loadKeyset();
      if (!keyset) throw new HttpError(503, 'credentials_not_configured');
      const tenantId = args.existing?.tenantId ?? currentTenantId();
      out.turnstileSecretEnc = encryptField(secret, { tenantId, rowId: args.id, field: TURNSTILE_SECRET_FIELD }, keyset);
      hasSecret = true;
    }
  }
  // Clearing the site key clears the secret too (back to the env default).
  if (!nextSiteKey && hasSecret && siteKeyGiven) {
    out.turnstileSecretEnc = null;
    hasSecret = false;
  }
  if (nextSiteKey && !hasSecret) throw new HttpError(400, 'form_turnstile_secret_required');
  if (!nextSiteKey && hasSecret) throw new HttpError(400, 'form_turnstile_site_key_required');
  return out;
}


/** Forms that require Turnstile must have either the workspace integration or a per-form widget. */
async function ensureTurnstileAvailable(args: {
  definition: { security?: { requireCaptcha?: boolean; captchaProvider?: string | null } } | undefined;
  turnstileSiteKey: string | null | undefined;
  turnstileHasSecret: boolean;
}): Promise<void> {
  const security = args.definition?.security;
  if (!security?.requireCaptcha || security.captchaProvider !== 'turnstile') return;
  if (args.turnstileSiteKey?.trim() && args.turnstileHasSecret) return;
  const ws = await getWorkspaceTurnstileKeys(currentTenantId());
  if (ws) return;
  throw new HttpError(400, 'form_turnstile_not_connected');
}

export async function create(args: { ownerId: string; input: CreateFormInput }): Promise<FormRow> {
  const scope = await resolveScopeLink({
    clientId: args.input.clientId ?? null,
    projectId: args.input.projectId ?? null,
  });

  const id = randomUUID();
  const turnstile = turnstileColumns({ id, existing: null, input: args.input.turnstile });
  await ensureTurnstileAvailable({
    definition: args.input.definition,
    turnstileSiteKey: turnstile.turnstileSiteKey ?? null,
    turnstileHasSecret: !!turnstile.turnstileSecretEnc,
  });
  const [row] = await db
    .insert(forms)
    .values(stampTenant({
      id,
      ownerUserId: args.ownerId,
      name: args.input.name,
      description: args.input.description ?? '',
      clientId: scope.clientId,
      projectId: scope.projectId,
      visibility: args.input.visibility ?? 'workspace',
      status: args.input.status ?? 'active',
      definition: args.input.definition,
      notifications: args.input.notifications ?? null,
      ...turnstile,
    }))
    .returning();
  if (!row) throw new Error('insert_failed');

  await appendActivity({
    whoId: args.ownerId,
    kind: 'forms.create',
    target: row.name,
  });

  return rowToRow(row);
}

export async function update(args: {
  id: string;
  ownerId: string;
  patch: UpdateFormInput;
}): Promise<FormRow> {
  const existing = await getOwned(args.id, args.ownerId);
  if (!existing) throw new HttpError(404, 'form_not_found');

  const upd: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  const changed: string[] = [];

  const hasClient = Object.prototype.hasOwnProperty.call(args.patch, 'clientId');
  const hasProject = Object.prototype.hasOwnProperty.call(args.patch, 'projectId');
  if (hasClient || hasProject) {
    const nextClientId = hasClient ? (args.patch.clientId ?? null) : existing.clientId;
    const nextProjectId = hasProject ? (args.patch.projectId ?? null) : existing.projectId;
    const scope = await resolveScopeLink({ clientId: nextClientId, projectId: nextProjectId });
    upd.clientId = scope.clientId;
    upd.projectId = scope.projectId;
    changed.push('clientId', 'projectId');
  }

  for (const k of ['name', 'description', 'visibility', 'status', 'definition', 'notifications'] as const) {
    const v = args.patch[k];
    if (v !== undefined) {
      upd[k] = v;
      changed.push(k);
    }
  }

  if (args.patch.turnstile !== undefined) {
    Object.assign(upd, turnstileColumns({ id: existing.id, existing, input: args.patch.turnstile }));
    changed.push('turnstile');
  }

  const nextDef = (upd.definition as FormDefinition | undefined) ?? asFormDefinition(existing.definition);
  const nextSite = (upd.turnstileSiteKey as string | null | undefined);
  const nextSecretEnc = (upd.turnstileSecretEnc as string | null | undefined);
  await ensureTurnstileAvailable({
    definition: nextDef,
    turnstileSiteKey: nextSite !== undefined ? nextSite : existing.turnstileSiteKey,
    turnstileHasSecret: (nextSecretEnc !== undefined ? nextSecretEnc : existing.turnstileSecretEnc) != null,
  });

  if (changed.length === 0) return rowToRow(existing);

  const [row] = await db
    .update(forms)
    .set(upd)
    .where(and(tenantEq(forms.tenantId), eq(forms.id, args.id), isNull(forms.archivedAt)))
    .returning();
  if (!row) throw new HttpError(404, 'form_not_found');

  await appendActivity({
    whoId: args.ownerId,
    kind: 'forms.update',
    target: `${row.name} · ${changed.join(', ')}`,
  });

  return rowToRow(row);
}

export async function softDelete(id: string, ownerId: string): Promise<void> {
  const existing = await getOwned(id, ownerId);
  if (!existing) throw new HttpError(404, 'form_not_found');

  await db
    .update(forms)
    .set({ archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
    .where(and(tenantEq(forms.tenantId), eq(forms.id, id), isNull(forms.archivedAt)));

  await appendActivity({
    whoId: ownerId,
    kind: 'forms.delete',
    target: existing.name,
  });
}

export async function listSubmissions(args: { formId: string; viewerId: string }): Promise<FormSubmissionRow[]> {
  const form = await getForViewer(args.formId, args.viewerId);
  if (!form) throw new HttpError(404, 'form_not_found');

  const rows = await db
    .select()
    .from(formSubmissions)
    .where(and(eq(formSubmissions.formId, form.id), eq(formSubmissions.tenantId, form.tenantId)))
    .orderBy(desc(formSubmissions.submittedAt))
    .limit(500);

  return rows.map(submissionToRow);
}

function csvCell(value: string): string {
  let s = value ?? '';
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function* submissionsCsvStream(args: {
  formId: string;
  viewerId: string;
}): AsyncGenerator<string> {
  const form = await getForViewer(args.formId, args.viewerId);
  if (!form) throw new HttpError(404, 'form_not_found');

  const definition = asFormDefinition(form.definition);
  const fieldIds = definition.fields.map((f) => f.id);
  yield ['submitted_at', 'session_id', ...fieldIds].map(csvCell).join(',') + '\r\n';

  let offset = 0;
  const page = 1000;
  for (;;) {
    const rows = await db
      .select()
      .from(formSubmissions)
      .where(and(eq(formSubmissions.formId, form.id), eq(formSubmissions.tenantId, form.tenantId)))
      .orderBy(desc(formSubmissions.submittedAt))
      .limit(page)
      .offset(offset);
    if (rows.length === 0) break;

    for (const row of rows) {
      const answers = (row.answers ?? {}) as Record<string, unknown>;
      const cols = fieldIds.map((id) => {
        const v = answers[id];
        if (Array.isArray(v)) return v.join('; ');
        if (v == null) return '';
        return String(v);
      });
      yield [row.submittedAt, row.sessionId ?? '', ...cols].map(csvCell).join(',') + '\r\n';
    }

    if (rows.length < page) break;
    offset += page;
  }
}

function fieldAllowsOptions(type: string): boolean {
  return type === 'select' || type === 'radio' || type === 'checkbox';
}

function validateAnswers(definition: FormDefinition, answers: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};

  for (const field of definition.fields) {
    if (!fieldIsVisible(field, answers)) continue;
    const raw = answers[field.id];
    const required = fieldIsRequired(field, answers);

    if (field.type === 'checkbox' && field.options.length > 0) {
      const arr = Array.isArray(raw) ? raw : [];
      if (required && arr.length === 0) {
        errors[field.id] = 'Please select at least one option.';
        continue;
      }
      if (!Array.isArray(raw) && raw !== undefined) {
        errors[field.id] = 'Invalid value.';
        continue;
      }
      const allowed = new Set(field.options.map((o) => o.value));
      if (arr.some((v) => typeof v !== 'string' || !allowed.has(v))) {
        errors[field.id] = 'Invalid option selected.';
      }
      continue;
    }

    if (field.type === 'checkbox') {
      const bool = raw === true || raw === 'true';
      if (required && !bool) {
        errors[field.id] = 'This checkbox is required.';
      }
      continue;
    }

    if (field.type === 'number') {
      if (raw === undefined || raw === null || raw === '') {
        if (required) errors[field.id] = 'This field is required.';
        continue;
      }
      const n = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(n)) {
        errors[field.id] = 'Please enter a valid number.';
        continue;
      }
      const min = field.validation.min;
      const max = field.validation.max;
      if (typeof min === 'number' && n < min) {
        errors[field.id] = `Must be at least ${min}.`;
        continue;
      }
      if (typeof max === 'number' && n > max) {
        errors[field.id] = `Must be at most ${max}.`;
      }
      continue;
    }

    const str = typeof raw === 'string' ? raw.trim() : '';
    if (!str) {
      if (required) errors[field.id] = 'This field is required.';
      continue;
    }

    if (fieldAllowsOptions(field.type) && field.options.length > 0) {
      const allowed = new Set(field.options.map((o) => o.value));
      if (!allowed.has(str)) {
        errors[field.id] = 'Invalid option selected.';
        continue;
      }
    }

    if (field.type === 'email') {
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
      if (!emailOk) {
        errors[field.id] = 'Please enter a valid email address.';
        continue;
      }
    }

    const minLength = field.validation.minLength;
    const maxLength = field.validation.maxLength;
    if (typeof minLength === 'number' && str.length < minLength) {
      errors[field.id] = `Must be at least ${minLength} characters.`;
      continue;
    }
    if (typeof maxLength === 'number' && str.length > maxLength) {
      errors[field.id] = `Must be at most ${maxLength} characters.`;
      continue;
    }

    if (field.validation.pattern) {
      try {
        const re = new RegExp(field.validation.pattern);
        if (!re.test(str)) {
          errors[field.id] = 'Value does not match expected format.';
        }
      } catch {
        errors[field.id] = 'Field validation pattern is invalid.';
      }
    }
  }

  return errors;
}

function normalizeAnswers(definition: FormDefinition, rawAnswers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of definition.fields) {
    if (!fieldIsVisible(field, rawAnswers)) continue;
    const raw = rawAnswers[field.id];
    if (field.type === 'checkbox' && field.options.length > 0) {
      out[field.id] = Array.isArray(raw) ? raw.filter((v) => typeof v === 'string') : [];
      continue;
    }
    if (field.type === 'checkbox') {
      out[field.id] = raw === true || raw === 'true';
      continue;
    }
    if (field.type === 'number') {
      if (raw === '' || raw === null || raw === undefined) {
        out[field.id] = null;
      } else {
        const n = typeof raw === 'number' ? raw : Number(raw);
        out[field.id] = Number.isFinite(n) ? n : null;
      }
      continue;
    }
    if (raw == null) {
      out[field.id] = '';
      continue;
    }
    out[field.id] = String(raw);
  }
  return out;
}

async function resolvePublicForm(token: string): Promise<Form> {
  const payload = decodeToken(token);
  const [row] = await db
    .select()
    .from(forms)
    .where(
      and(
        eq(forms.id, payload.formId),
        eq(forms.tenantId, payload.tenantId),
        eq(forms.status, 'active'),
        isNull(forms.archivedAt),
      ),
    )
    .limit(1);

  if (!row) throw new HttpError(404, 'form_not_found');
  return row;
}

export async function getPublicForm(args: { token: string; ctx: PublicRequestContext }): Promise<PublicFormPayload> {
  const row = await resolvePublicForm(args.token);
  const definition = asFormDefinition(row.definition);
  const security = asFormSecurity(definition);
  ensureAllowedEmbedContext({ security, origin: args.ctx.origin, referer: args.ctx.referer });
  const captchaProvider = security.requireCaptcha ? security.captchaProvider : null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    definition,
    security: {
      captchaProvider,
      captchaSiteKey: captchaProvider ? await resolveCaptchaSiteKey(captchaProvider, row) : null,
      honeypotFieldName: security.honeypotFieldName,
    },
  };
}

export async function recordPublicEvent(args: {
  token: string;
  input: TrackFormEventInput;
  origin: string | null;
  ip: string | null;
  userAgent: string | null;
  referer: string | null;
}): Promise<void> {
  const row = await resolvePublicForm(args.token);
  const definition = asFormDefinition(row.definition);
  ensureAllowedEmbedContext({ security: asFormSecurity(definition), origin: args.origin, referer: args.referer });

  await db.insert(formEvents).values({
    tenantId: row.tenantId,
    formId: row.id,
    sessionId: args.input.sessionId,
    eventType: args.input.type,
    path: args.input.path ?? null,
    ip: args.ip,
    userAgent: args.userAgent,
    referer: args.referer,
  });
}

export async function submitPublicForm(args: {
  token: string;
  input: PublicFormSubmitInput;
  origin: string | null;
  ip: string | null;
  userAgent: string | null;
  referer: string | null;
}): Promise<PublicFormSubmitResult> {
  const row = await resolvePublicForm(args.token);
  const definition = asFormDefinition(row.definition);
  const security = asFormSecurity(definition);
  ensureAllowedEmbedContext({ security, origin: args.origin, referer: args.referer });

  const honeypotFilled = !!(args.input.honey && args.input.honey.trim().length > 0);
  if (honeypotFilled) {
    return { ok: true, message: definition.successMessage };
  }

  if (security.requireCaptcha) {
    const provider = security.captchaProvider;
    if (!provider) {
      throw new HttpError(400, 'form_captcha_provider_missing');
    }
    const token = args.input.captchaToken?.trim() ?? '';
    if (!token) {
      return { ok: false, errors: { __form: 'Please complete the captcha challenge.' } };
    }
    const validCaptcha = await verifyCaptcha({ provider, token, remoteIp: args.ip, row });
    if (!validCaptcha) {
      return { ok: false, errors: { __form: 'Captcha verification failed. Please try again.' } };
    }
  }

  const errors = validateAnswers(definition, args.input.answers);
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const normalized = normalizeAnswers(definition, args.input.answers);

  const submittedAt = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(formSubmissions).values({
      tenantId: row.tenantId,
      formId: row.id,
      sessionId: args.input.sessionId,
      answers: normalized,
      ip: args.ip,
      userAgent: args.userAgent,
      referer: args.referer,
    }).returning({ submittedAt: formSubmissions.submittedAt });

    await tx.insert(formEvents).values({
      tenantId: row.tenantId,
      formId: row.id,
      sessionId: args.input.sessionId,
      eventType: 'submit',
      path: null,
      ip: args.ip,
      userAgent: args.userAgent,
      referer: args.referer,
    });
    return inserted?.submittedAt ?? new Date().toISOString();
  });

  // Activity feed + email. Fire-and-forget: never delays or fails the
  // visitor's submit (notifyNewSubmission swallows its own errors).
  void notifyNewSubmission({ form: row, answers: normalized, submittedAt, referer: args.referer });

  return { ok: true, message: definition.successMessage };
}

/** Settings-UI status: sender connected, which captcha keys exist. */
export async function getFormsConfig(): Promise<FormsConfig> {
  const sender = await senderStatus();
  return {
    senderConnected: sender.connected,
    senderName: sender.name,
    captcha: {
      hcaptcha: !!(env.HCAPTCHA_SITE_KEY && env.HCAPTCHA_SECRET),
      recaptcha: !!(env.RECAPTCHA_SITE_KEY && env.RECAPTCHA_SECRET),
      turnstile: (await getTurnstileStatus()).connected,
    },
    secretStorageReady: !!loadKeyset().keyset,
  };
}
