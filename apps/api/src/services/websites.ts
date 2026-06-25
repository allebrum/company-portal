import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { CreateWebsiteInput, UpdateWebsiteInput, WebsiteCredentialsRow, WebsiteRow } from '@allebrum/shared';
import { db } from '../db/client.js';
import { websiteMembers, websites, type Website } from '../db/schema.js';
import { env } from '../env.js';
import { HttpError } from '../middleware/errorHandler.js';
import { tenantEq, stampTenant } from '../tenancy/scope.js';
import { appendActivity } from './activity.js';

const ENC_ALGO = 'aes-256-gcm';
const ENC_PREFIX = 'v1';
const IV_LEN = 12;

type EncPair = {
  credentialUsernameEnc: string | null;
  credentialPasswordEnc: string | null;
  credentialsUpdatedAt: string | null;
};

function normalizedAssignedUserIds(ids: string[] | undefined): string[] | undefined {
  if (!ids) return undefined;
  return [...new Set(ids.filter(Boolean))];
}

function getCredentialKey(): Buffer | null {
  const secret = env.WEBSITES_CREDENTIALS_SECRET?.trim();
  if (!secret) return null;
  return createHash('sha256').update(secret).digest();
}

function encryptText(value: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ENC_ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    ENC_PREFIX,
    iv.toString('base64url'),
    ciphertext.toString('base64url'),
    tag.toString('base64url'),
  ].join('.');
}

function decryptText(value: string, key: Buffer): string {
  const [version, ivB64, ciphertextB64, tagB64] = value.split('.');
  if (version !== ENC_PREFIX || !ivB64 || !ciphertextB64 || !tagB64) {
    throw new Error('bad_format');
  }
  const iv = Buffer.from(ivB64, 'base64url');
  const ciphertext = Buffer.from(ciphertextB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const decipher = createDecipheriv(ENC_ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

function hasUsableCredentialValue(value: string | null | undefined): boolean {
  return typeof value === 'string' ? value.trim().length > 0 : false;
}

function sanitizeCredentialValue(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function encryptCredentialPatch(
  credentials: { username?: string | null; password?: string | null } | undefined,
): EncPair | undefined {
  if (!credentials) return undefined;

  const username = credentials.username !== undefined ? sanitizeCredentialValue(credentials.username) : undefined;
  const password = credentials.password !== undefined ? sanitizeCredentialValue(credentials.password) : undefined;

  const hasAnyPatch = username !== undefined || password !== undefined;
  if (!hasAnyPatch) return undefined;

  const key = getCredentialKey();
  const requiresKey = hasUsableCredentialValue(username) || hasUsableCredentialValue(password);
  if (requiresKey && !key) {
    throw new HttpError(400, 'websites_credentials_secret_missing');
  }

  return {
    credentialUsernameEnc: username === undefined ? null : (username ? encryptText(username, key!) : null),
    credentialPasswordEnc: password === undefined ? null : (password ? encryptText(password, key!) : null),
    credentialsUpdatedAt: new Date().toISOString(),
  };
}

function rowToRow(r: Website, assignedUserIds: string[]): WebsiteRow {
  return {
    id: r.id,
    name: r.name,
    siteUrl: r.siteUrl,
    category: r.category,
    status: r.status as WebsiteRow['status'],
    billingCycle: r.billingCycle as WebsiteRow['billingCycle'],
    billingAmountCents: r.billingAmountCents,
    billingCurrency: r.billingCurrency,
    renewalDate: r.renewalDate,
    notes: r.notes,
    assignedUserIds,
    hasCredentialUsername: !!r.credentialUsernameEnc,
    hasCredentialPassword: !!r.credentialPasswordEnc,
    credentialsUpdatedAt: r.credentialsUpdatedAt,
    createdByUserId: r.createdByUserId,
    updatedByUserId: r.updatedByUserId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    archivedAt: r.archivedAt,
  };
}

async function buildRows(rows: Website[]): Promise<WebsiteRow[]> {
  if (rows.length === 0) return [];
  const websiteIds = rows.map((r) => r.id);
  const members = await db
    .select({ websiteId: websiteMembers.websiteId, userId: websiteMembers.userId })
    .from(websiteMembers)
    .where(and(tenantEq(websiteMembers.tenantId), inArray(websiteMembers.websiteId, websiteIds)));

  const byWebsite = new Map<string, string[]>();
  for (const m of members) {
    const arr = byWebsite.get(m.websiteId) ?? [];
    arr.push(m.userId);
    byWebsite.set(m.websiteId, arr);
  }

  return rows.map((r) => rowToRow(r, byWebsite.get(r.id) ?? []));
}

async function getRowForTenant(id: string): Promise<Website | null> {
  const [row] = await db
    .select()
    .from(websites)
    .where(and(tenantEq(websites.tenantId), eq(websites.id, id), isNull(websites.archivedAt)))
    .limit(1);
  return row ?? null;
}

export async function listWebsites(): Promise<WebsiteRow[]> {
  const rows = await db
    .select()
    .from(websites)
    .where(and(tenantEq(websites.tenantId), isNull(websites.archivedAt)))
    .orderBy(desc(websites.createdAt), sql`lower(${websites.name})`);
  return buildRows(rows);
}

export async function createWebsite(args: {
  actorId: string;
  input: CreateWebsiteInput;
}): Promise<WebsiteRow> {
  const assignedUserIds = normalizedAssignedUserIds(args.input.assignedUserIds) ?? [];
  const credentialPatch = encryptCredentialPatch(args.input.credentials);

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(websites)
      .values(stampTenant({
        name: args.input.name,
        siteUrl: args.input.siteUrl,
        category: args.input.category ?? '',
        status: args.input.status ?? 'active',
        billingCycle: args.input.billingCycle ?? 'monthly',
        billingAmountCents: args.input.billingAmountCents ?? null,
        billingCurrency: (args.input.billingCurrency ?? 'USD').toUpperCase(),
        renewalDate: args.input.renewalDate ?? null,
        notes: args.input.notes ?? '',
        createdByUserId: args.actorId,
        updatedByUserId: args.actorId,
        credentialUsernameEnc: credentialPatch?.credentialUsernameEnc ?? null,
        credentialPasswordEnc: credentialPatch?.credentialPasswordEnc ?? null,
        credentialsUpdatedAt: credentialPatch?.credentialsUpdatedAt ?? null,
      }))
      .returning();
    if (!row) throw new Error('insert_failed');

    await tx
      .delete(websiteMembers)
      .where(and(eq(websiteMembers.websiteId, row.id), tenantEq(websiteMembers.tenantId)));
    if (assignedUserIds.length > 0) {
      await tx.insert(websiteMembers).values(
        assignedUserIds.map((userId) =>
          stampTenant({
            websiteId: row.id,
            userId,
          }),
        ),
      );
    }
    return row;
  });

  await appendActivity({
    whoId: args.actorId,
    kind: 'websites.create',
    target: `${created.name} (${created.siteUrl})`,
  });

  return rowToRow(created, assignedUserIds);
}

export async function updateWebsite(args: {
  id: string;
  actorId: string;
  patch: UpdateWebsiteInput;
}): Promise<WebsiteRow> {
  const existing = await getRowForTenant(args.id);
  if (!existing) throw new HttpError(404, 'website_not_found');

  const assignedUserIds = normalizedAssignedUserIds(args.patch.assignedUserIds);
  const credentialPatch = encryptCredentialPatch(args.patch.credentials);

  const changedKeys: string[] = [];
  const upd: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
    updatedByUserId: args.actorId,
  };

  for (const key of [
    'name',
    'siteUrl',
    'category',
    'status',
    'billingCycle',
    'billingAmountCents',
    'billingCurrency',
    'renewalDate',
    'notes',
  ] as const) {
    const value = args.patch[key];
    if (value !== undefined) {
      upd[key] = key === 'billingCurrency' && typeof value === 'string' ? value.toUpperCase() : value;
      changedKeys.push(key);
    }
  }

  if (credentialPatch) {
    if (credentialPatch.credentialUsernameEnc !== null || args.patch.credentials?.username !== undefined) {
      upd.credentialUsernameEnc = credentialPatch.credentialUsernameEnc;
      changedKeys.push('credentials.username');
    }
    if (credentialPatch.credentialPasswordEnc !== null || args.patch.credentials?.password !== undefined) {
      upd.credentialPasswordEnc = credentialPatch.credentialPasswordEnc;
      changedKeys.push('credentials.password');
    }
    upd.credentialsUpdatedAt = credentialPatch.credentialsUpdatedAt;
  }

  const updated = await db.transaction(async (tx) => {
    let row = existing;
    if (changedKeys.length > 0) {
      const [saved] = await tx
        .update(websites)
        .set(upd)
        .where(and(eq(websites.id, args.id), tenantEq(websites.tenantId), isNull(websites.archivedAt)))
        .returning();
      if (!saved) throw new HttpError(404, 'website_not_found');
      row = saved;
    }

    if (assignedUserIds !== undefined) {
      await tx
        .delete(websiteMembers)
        .where(and(eq(websiteMembers.websiteId, args.id), tenantEq(websiteMembers.tenantId)));
      if (assignedUserIds.length > 0) {
        await tx.insert(websiteMembers).values(
          assignedUserIds.map((userId) =>
            stampTenant({
              websiteId: args.id,
              userId,
            }),
          ),
        );
      }
      changedKeys.push('assignedUserIds');
    }

    return row;
  });

  await appendActivity({
    whoId: args.actorId,
    kind: 'websites.update',
    target: `${updated.name} · ${changedKeys.join(', ') || 'no-op'}`,
  });

  const [rows] = await Promise.all([buildRows([updated])]);
  return rows[0]!;
}

export async function archiveWebsite(args: { id: string; actorId: string }): Promise<void> {
  const existing = await getRowForTenant(args.id);
  if (!existing) throw new HttpError(404, 'website_not_found');

  await db
    .update(websites)
    .set({ archivedAt: new Date().toISOString(), updatedByUserId: args.actorId, updatedAt: new Date().toISOString() })
    .where(and(eq(websites.id, args.id), tenantEq(websites.tenantId), isNull(websites.archivedAt)));

  await appendActivity({
    whoId: args.actorId,
    kind: 'websites.delete',
    target: existing.name,
  });
}

export async function readCredentials(args: {
  id: string;
  viewerId: string;
}): Promise<WebsiteCredentialsRow> {
  const row = await getRowForTenant(args.id);
  if (!row) throw new HttpError(404, 'website_not_found');

  const key = getCredentialKey();
  if (!key) {
    throw new HttpError(400, 'websites_credentials_secret_missing');
  }

  let username: string | null = null;
  let password: string | null = null;
  try {
    username = row.credentialUsernameEnc ? decryptText(row.credentialUsernameEnc, key) : null;
    password = row.credentialPasswordEnc ? decryptText(row.credentialPasswordEnc, key) : null;
  } catch {
    throw new HttpError(500, 'websites_credentials_decrypt_failed');
  }

  await appendActivity({
    whoId: args.viewerId,
    kind: 'websites.credentials.read',
    target: `${row.name}`,
  });

  return {
    websiteId: row.id,
    username,
    password,
    updatedAt: row.credentialsUpdatedAt,
  };
}
