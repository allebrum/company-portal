import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import {
  FULL_EXCLUDED_SCOPES,
  type ApiTokenScope,
  type CreateCredentialInput,
  type CredentialAccess,
  type CredentialAccessLogRow,
  type CredentialAllowlistEntry,
  type CredentialAllowlistResponse,
  type CredentialKind,
  type CredentialLogAction,
  type CredentialLogOutcome,
  type CredentialReveal,
  type CredentialRow,
  type UpdateCredentialInput,
} from '@allebrum/shared';
import { db } from '../db/client.js';
import {
  clients,
  credentialAccessLog,
  credentialClientAccess,
  credentials,
  projects,
  tenantMembers,
  type CredentialDbRow,
} from '../db/schema.js';
import { env } from '../env.js';
import { HttpError } from '../middleware/errorHandler.js';
import { decryptField, encryptField, KeysetError, parseKeyset, type Keyset } from '../lib/crypto.js';
import { parseTotp, totpCode } from '../lib/totp.js';
import { currentTenantId } from '../tenancy/context.js';
import { getEffectivePermissions } from '../auth/permissions.js';
import { tenantEq } from '../tenancy/scope.js';

/**
 * Project / client credentials vault.
 *
 * Security properties (see docs/CREDENTIALS.md):
 *   - Secret columns (`secret_enc`, `notes_enc`, `totp_enc`) are only ever
 *     selected by `revealCredential` and the rotation script. List queries
 *     select an explicit metadata column set.
 *   - Access = workspace-wide `credentials.*` permission (Owner by default)
 *     OR an entry on the client's allowlist. Project credentials follow
 *     their client's allowlist.
 *   - Nothing here touches the activity feed or sockets. Every reveal and
 *     change, including failures, goes to `credential_access_log`.
 *   - No keyset → fail closed (503 `credentials_not_configured`).
 */

// ---------------------------------------------------------------------------
// Keyset (cached per env value; never logged)

let cached: { raw: string; keyset: Keyset | null; error: string | null } | null = null;

export function loadKeyset(): { keyset: Keyset | null; error: string | null } {
  const raw = `${env.CREDENTIALS_ACTIVE_KID ?? ''}\u0000${env.CREDENTIALS_KEYS ?? ''}`;
  if (cached?.raw === raw) return cached;
  let keyset: Keyset | null = null;
  let error: string | null = null;
  try {
    keyset = parseKeyset(env.CREDENTIALS_KEYS, env.CREDENTIALS_ACTIVE_KID);
  } catch (e) {
    error = e instanceof KeysetError ? e.code : 'credentials_keys_invalid';
    if (error !== 'credentials_not_configured') {
      console.warn(`[credentials] keyset rejected (${error}); the credentials vault is disabled until it is fixed.`);
    }
  }
  cached = { raw, keyset, error };
  return cached;
}

export function credentialsConfigured(): boolean {
  return loadKeyset().keyset !== null;
}

function requireKeyset(): Keyset {
  const { keyset } = loadKeyset();
  if (!keyset) throw new HttpError(503, 'credentials_not_configured');
  return keyset;
}

// ---------------------------------------------------------------------------
// Access model

export interface CredentialActor {
  userId: string;
  /** Effective permissions in the active workspace (owner's live role for tokens). */
  perms: ReadonlySet<string>;
  /** Present for personal-access-token requests. */
  token?: { id: string; name: string; scopes: readonly ApiTokenScope[] } | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Pure access decision for one client. Workspace-wide permissions apply to
 * every client; an allowlist entry grants view + reveal (and manage when
 * `canManage`) on that client only. Token requests are further capped by the
 * token's explicitly-picked credentials scopes (`full` never implies them).
 */
export function resolveCredentialAccess(
  perms: ReadonlySet<string>,
  allow: { canManage: boolean } | null,
  opts: { configured: boolean; tokenScopes?: readonly string[] | null },
): CredentialAccess {
  const viewAll = perms.has('credentials.view') || perms.has('credentials.reveal') || perms.has('credentials.manage');
  let canView = viewAll || !!allow;
  let canReveal = perms.has('credentials.reveal') || !!allow;
  let canManage = perms.has('credentials.manage') || !!allow?.canManage;
  let canManageAccess = perms.has('credentials.manage');
  if (opts.tokenScopes) {
    const s = opts.tokenScopes;
    const read = s.includes('credentials:read');
    const write = s.includes('credentials:write');
    canView = canView && (read || write);
    canReveal = canReveal && read;
    canManage = canManage && write;
    canManageAccess = false; // allowlist + access log are session-only
  }
  return {
    configured: opts.configured,
    canView,
    canReveal,
    canManage,
    canManageAccess,
    viaAllowlist: !!allow && !viewAll,
  };
}

async function loadAllow(userId: string, clientId: string): Promise<{ canManage: boolean } | null> {
  const [row] = await db
    .select({ canManage: credentialClientAccess.canManage })
    .from(credentialClientAccess)
    .where(
      and(
        tenantEq(credentialClientAccess.tenantId),
        eq(credentialClientAccess.clientId, clientId),
        eq(credentialClientAccess.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function accessFor(actor: CredentialActor, clientId: string): Promise<CredentialAccess> {
  const allow = await loadAllow(actor.userId, clientId);
  return resolveCredentialAccess(actor.perms, allow, {
    configured: credentialsConfigured(),
    tokenScopes: actor.token ? actor.token.scopes.filter((s) => (FULL_EXCLUDED_SCOPES as readonly string[]).includes(s)) : null,
  });
}

// ---------------------------------------------------------------------------
// Audit log (never the activity feed)

export async function logCredentialEvent(
  actor: CredentialActor | null,
  e: {
    action: CredentialLogAction;
    outcome: CredentialLogOutcome;
    credentialId?: string | null;
    clientId?: string | null;
    label?: string;
  },
): Promise<void> {
  try {
    await db.insert(credentialAccessLog).values({
      tenantId: currentTenantId(),
      credentialId: e.credentialId ?? null,
      clientId: e.clientId ?? null,
      label: (e.label ?? '').slice(0, 200),
      userId: actor?.userId ?? null,
      tokenId: actor?.token?.id ?? null,
      tokenName: actor?.token?.name ?? null,
      action: e.action,
      outcome: e.outcome,
      ip: actor?.ip ?? null,
      userAgent: actor?.userAgent?.slice(0, 400) ?? null,
    });
  } catch (err) {
    // Never let an audit write failure leak details; the caller's own error
    // handling still applies. Log only the failure class.
    console.warn('[credentials] audit log write failed:', err instanceof Error ? err.name : 'unknown');
  }
}

// ---------------------------------------------------------------------------
// Scope resolution

type Owner = { clientId: string; projectId: string | null; projectName: string | null };

async function resolveClient(clientId: string): Promise<Owner> {
  const [c] = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(tenantEq(clients.tenantId), eq(clients.id, clientId)))
    .limit(1);
  if (!c) throw new HttpError(404, 'client_not_found');
  return { clientId: c.id, projectId: null, projectName: null };
}

async function resolveProject(projectId: string): Promise<Owner> {
  const [p] = await db
    .select({ id: projects.id, clientId: projects.clientId, name: projects.name })
    .from(projects)
    .where(and(tenantEq(projects.tenantId), eq(projects.id, projectId)))
    .limit(1);
  if (!p) throw new HttpError(404, 'project_not_found');
  return { clientId: p.clientId, projectId: p.id, projectName: p.name };
}

export async function resolveScope(q: { clientId?: string | null; projectId?: string | null }): Promise<Owner> {
  if (q.projectId) return resolveProject(q.projectId);
  if (q.clientId) return resolveClient(q.clientId);
  throw new HttpError(400, 'client_or_project_required');
}

/** Metadata columns only — the encrypted columns are reduced to booleans. */
export const CREDENTIAL_META_COLUMNS = {
  id: credentials.id,
  clientId: credentials.clientId,
  projectId: credentials.projectId,
  projectName: projects.name,
  label: credentials.label,
  kind: credentials.kind,
  host: credentials.host,
  port: credentials.port,
  url: credentials.url,
  username: credentials.username,
  hasSecret: sql<boolean>`${credentials.secretEnc} is not null`,
  hasNotes: sql<boolean>`${credentials.notesEnc} is not null`,
  hasTotp: sql<boolean>`${credentials.totpEnc} is not null`,
  secretUpdatedAt: credentials.secretUpdatedAt,
  lastRevealedAt: credentials.lastRevealedAt,
  createdByUserId: credentials.createdByUserId,
  createdAt: credentials.createdAt,
  updatedAt: credentials.updatedAt,
};

function toRow(r: Record<keyof typeof CREDENTIAL_META_COLUMNS, unknown>): CredentialRow {
  return {
    id: r.id as string,
    clientId: (r.clientId as string | null) ?? null,
    projectId: (r.projectId as string | null) ?? null,
    projectName: (r.projectName as string | null) ?? null,
    label: r.label as string,
    kind: r.kind as CredentialKind,
    host: r.host as string,
    port: (r.port as number | null) ?? null,
    url: r.url as string,
    username: r.username as string,
    hasSecret: !!r.hasSecret,
    hasNotes: !!r.hasNotes,
    hasTotp: !!r.hasTotp,
    secretUpdatedAt: (r.secretUpdatedAt as string | null) ?? null,
    lastRevealedAt: (r.lastRevealedAt as string | null) ?? null,
    createdByUserId: (r.createdByUserId as string | null) ?? null,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
  };
}

/**
 * Client scope → the client's own credentials plus every credential on its
 * projects (the rollup). Project scope → that project's credentials only.
 */
export async function listCredentials(owner: Owner): Promise<CredentialRow[]> {
  const scopeCond = owner.projectId
    ? eq(credentials.projectId, owner.projectId)
    : or(
        eq(credentials.clientId, owner.clientId),
        inArray(
          credentials.projectId,
          db.select({ id: projects.id }).from(projects).where(and(tenantEq(projects.tenantId), eq(projects.clientId, owner.clientId))),
        ),
      );
  const rows = await db
    .select(CREDENTIAL_META_COLUMNS)
    .from(credentials)
    .leftJoin(projects, eq(projects.id, credentials.projectId))
    .where(and(tenantEq(credentials.tenantId), isNull(credentials.deletedAt), scopeCond))
    .orderBy(sql`${projects.name} nulls first`, credentials.label);
  return rows.map(toRow);
}

async function getRow(id: string): Promise<(CredentialDbRow & { effectiveClientId: string }) | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db
    .select({ c: credentials, projectClientId: projects.clientId })
    .from(credentials)
    .leftJoin(projects, eq(projects.id, credentials.projectId))
    .where(and(tenantEq(credentials.tenantId), eq(credentials.id, id), isNull(credentials.deletedAt)))
    .limit(1);
  if (!row) return null;
  const effectiveClientId = row.c.clientId ?? row.projectClientId;
  if (!effectiveClientId) return null;
  return { ...row.c, effectiveClientId };
}

async function getMetaRow(id: string): Promise<CredentialRow> {
  const [r] = await db
    .select(CREDENTIAL_META_COLUMNS)
    .from(credentials)
    .leftJoin(projects, eq(projects.id, credentials.projectId))
    .where(and(tenantEq(credentials.tenantId), eq(credentials.id, id)))
    .limit(1);
  if (!r) throw new HttpError(404, 'credential_not_found');
  return toRow(r);
}

// ---------------------------------------------------------------------------
// Writes

function normalizeTotp(v: string): string {
  const t = v.trim();
  if (!t) return '';
  try {
    parseTotp(t);
  } catch {
    throw new HttpError(400, 'invalid_totp_secret');
  }
  return /^otpauth:\/\//i.test(t) ? t : t.toUpperCase().replace(/[\s-]/g, '');
}

export async function createCredential(actor: CredentialActor, input: CreateCredentialInput): Promise<CredentialRow> {
  const owner = await resolveScope({ clientId: input.clientId, projectId: input.projectId });
  const access = await accessFor(actor, owner.clientId);
  if (!access.canManage) {
    await logCredentialEvent(actor, { action: 'create', outcome: 'denied', clientId: owner.clientId, label: input.label });
    throw new HttpError(403, 'forbidden');
  }
  let keyset: Keyset;
  try {
    keyset = requireKeyset();
  } catch (e) {
    await logCredentialEvent(actor, { action: 'create', outcome: 'not_configured', clientId: owner.clientId, label: input.label });
    throw e;
  }
  const id = randomUUID();
  const tenantId = currentTenantId();
  const enc = (field: string, v: string | undefined) => (v ? encryptField(v, { tenantId, rowId: id, field }, keyset) : null);
  const totp = normalizeTotp(input.totpSecret ?? '');
  const now = new Date().toISOString();
  await db.insert(credentials).values({
    id,
    tenantId,
    clientId: owner.projectId ? null : owner.clientId,
    projectId: owner.projectId,
    label: input.label,
    kind: input.kind ?? 'other',
    host: input.host ?? '',
    port: input.port ?? null,
    url: input.url ?? '',
    username: input.username ?? '',
    secretEnc: enc('secret', input.secret),
    notesEnc: enc('notes', input.notes),
    totpEnc: enc('totp', totp),
    secretUpdatedAt: input.secret ? now : null,
    createdByUserId: actor.userId,
    updatedByUserId: actor.userId,
  });
  await logCredentialEvent(actor, { action: 'create', outcome: 'ok', credentialId: id, clientId: owner.clientId, label: input.label });
  return getMetaRow(id);
}

export async function updateCredential(actor: CredentialActor, id: string, patch: UpdateCredentialInput): Promise<CredentialRow> {
  const row = await getRow(id);
  if (!row) {
    await logCredentialEvent(actor, { action: 'update', outcome: 'not_found' });
    throw new HttpError(404, 'credential_not_found');
  }
  const access = await accessFor(actor, row.effectiveClientId);
  if (!access.canManage) {
    await logCredentialEvent(actor, { action: 'update', outcome: 'denied', credentialId: id, clientId: row.effectiveClientId, label: row.label });
    throw new HttpError(403, 'forbidden');
  }
  let keyset: Keyset;
  try {
    keyset = requireKeyset();
  } catch (e) {
    await logCredentialEvent(actor, { action: 'update', outcome: 'not_configured', credentialId: id, clientId: row.effectiveClientId, label: row.label });
    throw e;
  }
  const tenantId = currentTenantId();
  const enc = (field: string, v: string) => (v ? encryptField(v, { tenantId, rowId: id, field }, keyset) : null);
  const now = new Date().toISOString();
  const upd: Partial<typeof credentials.$inferInsert> = { updatedAt: now, updatedByUserId: actor.userId };
  if (patch.label !== undefined) upd.label = patch.label;
  if (patch.kind !== undefined) upd.kind = patch.kind;
  if (patch.host !== undefined) upd.host = patch.host;
  if (patch.port !== undefined) upd.port = patch.port;
  if (patch.url !== undefined) upd.url = patch.url;
  if (patch.username !== undefined) upd.username = patch.username;
  if (patch.secret !== undefined) {
    upd.secretEnc = enc('secret', patch.secret);
    upd.secretUpdatedAt = patch.secret ? now : null;
  }
  if (patch.notes !== undefined) upd.notesEnc = enc('notes', patch.notes);
  if (patch.totpSecret !== undefined) upd.totpEnc = enc('totp', normalizeTotp(patch.totpSecret));
  await db.update(credentials).set(upd).where(and(tenantEq(credentials.tenantId), eq(credentials.id, id)));
  await logCredentialEvent(actor, {
    action: 'update',
    outcome: 'ok',
    credentialId: id,
    clientId: row.effectiveClientId,
    label: patch.label ?? row.label,
  });
  return getMetaRow(id);
}

export async function deleteCredential(actor: CredentialActor, id: string): Promise<void> {
  const row = await getRow(id);
  if (!row) {
    await logCredentialEvent(actor, { action: 'delete', outcome: 'not_found' });
    throw new HttpError(404, 'credential_not_found');
  }
  const access = await accessFor(actor, row.effectiveClientId);
  if (!access.canManage) {
    await logCredentialEvent(actor, { action: 'delete', outcome: 'denied', credentialId: id, clientId: row.effectiveClientId, label: row.label });
    throw new HttpError(403, 'forbidden');
  }
  // Soft delete, and drop the ciphertext so a deleted secret can't be revealed later.
  await db
    .update(credentials)
    .set({ deletedAt: new Date().toISOString(), secretEnc: null, notesEnc: null, totpEnc: null, updatedByUserId: actor.userId })
    .where(and(tenantEq(credentials.tenantId), eq(credentials.id, id)));
  await logCredentialEvent(actor, { action: 'delete', outcome: 'ok', credentialId: id, clientId: row.effectiveClientId, label: row.label });
}

// ---------------------------------------------------------------------------
// Reveal — the ONLY path that returns plaintext.

export async function revealCredential(actor: CredentialActor, id: string): Promise<CredentialReveal> {
  const row = await getRow(id);
  if (!row) {
    await logCredentialEvent(actor, { action: 'reveal', outcome: 'not_found' });
    throw new HttpError(404, 'credential_not_found');
  }
  const base = { credentialId: id, clientId: row.effectiveClientId, label: row.label };
  const access = await accessFor(actor, row.effectiveClientId);
  if (!access.canReveal) {
    await logCredentialEvent(actor, { action: 'reveal', outcome: 'denied', ...base });
    throw new HttpError(403, 'forbidden');
  }
  const { keyset } = loadKeyset();
  if (!keyset) {
    await logCredentialEvent(actor, { action: 'reveal', outcome: 'not_configured', ...base });
    throw new HttpError(503, 'credentials_not_configured');
  }
  const tenantId = currentTenantId();
  let secret: string | null = null;
  let notes: string | null = null;
  let totp: CredentialReveal['totp'] = null;
  try {
    const ctx = (field: string) => ({ tenantId, rowId: id, field });
    secret = row.secretEnc ? decryptField(row.secretEnc, ctx('secret'), keyset) : null;
    notes = row.notesEnc ? decryptField(row.notesEnc, ctx('notes'), keyset) : null;
    if (row.totpEnc) totp = totpCode(parseTotp(decryptField(row.totpEnc, ctx('totp'), keyset)));
  } catch {
    await logCredentialEvent(actor, { action: 'reveal', outcome: 'decrypt_failed', ...base });
    throw new HttpError(500, 'credentials_decrypt_failed');
  }
  await db
    .update(credentials)
    .set({ lastRevealedAt: new Date().toISOString() })
    .where(and(tenantEq(credentials.tenantId), eq(credentials.id, id)));
  await logCredentialEvent(actor, { action: 'reveal', outcome: 'ok', ...base });
  return { credentialId: id, username: row.username, secret, notes, totp };
}

/** Best-effort audit entry for a rate-limited reveal (called by the limiter). */
export async function logRateLimitedReveal(actor: CredentialActor, id: string): Promise<void> {
  const row = await getRow(id).catch(() => null);
  await logCredentialEvent(actor, {
    action: 'reveal',
    outcome: 'rate_limited',
    credentialId: row?.id ?? null,
    clientId: row?.effectiveClientId ?? null,
    label: row?.label ?? '',
  });
}

// ---------------------------------------------------------------------------
// Allowlist (workspace-wide credentials.manage only; session only)

export async function getAllowlist(clientId: string): Promise<CredentialAllowlistResponse> {
  await resolveClient(clientId);
  const tenantId = currentTenantId();
  const entries: CredentialAllowlistEntry[] = await db
    .select({
      userId: credentialClientAccess.userId,
      canManage: credentialClientAccess.canManage,
      grantedByUserId: credentialClientAccess.grantedByUserId,
      createdAt: credentialClientAccess.createdAt,
    })
    .from(credentialClientAccess)
    .where(and(tenantEq(credentialClientAccess.tenantId), eq(credentialClientAccess.clientId, clientId)));
  const members = await db.select({ userId: tenantMembers.userId }).from(tenantMembers).where(eq(tenantMembers.tenantId, tenantId));
  const workspaceWideUserIds: string[] = [];
  for (const m of members) {
    const p = await getEffectivePermissions(m.userId, tenantId);
    if (p.has('credentials.view') || p.has('credentials.reveal') || p.has('credentials.manage')) workspaceWideUserIds.push(m.userId);
  }
  return { entries, workspaceWideUserIds };
}

export async function setAllowlist(
  actor: CredentialActor,
  clientId: string,
  entries: { userId: string; canManage: boolean }[],
): Promise<CredentialAllowlistResponse> {
  await resolveClient(clientId);
  const tenantId = currentTenantId();
  const unique = new Map(entries.map((e) => [e.userId, e]));
  if (unique.size > 0) {
    // Only members of this workspace can be allowlisted.
    const members = await db
      .select({ userId: tenantMembers.userId })
      .from(tenantMembers)
      .where(and(eq(tenantMembers.tenantId, tenantId), inArray(tenantMembers.userId, [...unique.keys()])));
    const ok = new Set(members.map((m) => m.userId));
    const bad = [...unique.keys()].filter((u) => !ok.has(u));
    if (bad.length > 0) throw new HttpError(400, 'user_not_in_workspace');
  }
  await db.transaction(async (tx) => {
    await tx
      .delete(credentialClientAccess)
      .where(and(eq(credentialClientAccess.tenantId, tenantId), eq(credentialClientAccess.clientId, clientId)));
    if (unique.size > 0) {
      await tx.insert(credentialClientAccess).values(
        [...unique.values()].map((e) => ({
          tenantId,
          clientId,
          userId: e.userId,
          canManage: e.canManage,
          grantedByUserId: actor.userId,
        })),
      );
    }
  });
  await logCredentialEvent(actor, {
    action: 'access.update',
    outcome: 'ok',
    clientId,
    label: `${unique.size} ${unique.size === 1 ? 'person' : 'people'} on allowlist`,
  });
  return getAllowlist(clientId);
}

// ---------------------------------------------------------------------------
// Access log (workspace-wide credentials.manage only; session only)

export async function listAccessLog(q: { clientId?: string; limit: number }): Promise<CredentialAccessLogRow[]> {
  const rows = await db
    .select()
    .from(credentialAccessLog)
    .where(
      and(
        tenantEq(credentialAccessLog.tenantId),
        q.clientId ? eq(credentialAccessLog.clientId, q.clientId) : undefined,
      ),
    )
    .orderBy(desc(credentialAccessLog.createdAt))
    .limit(q.limit);
  return rows.map((r) => ({
    id: r.id,
    credentialId: r.credentialId,
    clientId: r.clientId,
    label: r.label,
    userId: r.userId,
    tokenId: r.tokenId,
    tokenName: r.tokenName,
    action: r.action as CredentialAccessLogRow['action'],
    outcome: r.outcome as CredentialAccessLogRow['outcome'],
    ip: r.ip,
    userAgent: r.userAgent,
    createdAt: r.createdAt,
  }));
}
