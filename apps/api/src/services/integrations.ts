import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  integrations,
  driveLinkedFolders,
  driveItems,
  type Integration,
  type DriveFolder,
  type DriveItem,
} from '../db/schema.js';
import type { ConnectIntegrationInput, LinkFolderInput, IntegrationKind } from '@allebrum/shared';
import { EV } from '@allebrum/shared';
import { emit } from '../realtime/emit.js';
import { appendActivity } from './activity.js';
import { HttpError } from '../middleware/errorHandler.js';
import { tenantEq, stampTenant } from '../tenancy/scope.js';

export async function listIntegrations(): Promise<Integration[]> {
  return db.select().from(integrations).where(tenantEq(integrations.tenantId));
}

export async function getIntegration(kind: IntegrationKind): Promise<Integration | undefined> {
  const rows = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.kind, kind), tenantEq(integrations.tenantId)))
    .limit(1);
  return rows[0];
}

async function upsertIntegration(kind: IntegrationKind, patch: Partial<Integration>): Promise<Integration> {
  const existing = await getIntegration(kind);
  if (existing) {
    const [updated] = await db
      .update(integrations)
      .set({ ...patch, updatedAt: new Date().toISOString() })
      .where(and(eq(integrations.kind, kind), tenantEq(integrations.tenantId)))
      .returning();
    if (!updated) throw new Error('integration update failed');
    return updated;
  }
  const [created] = await db
    .insert(integrations)
    .values(stampTenant({
      kind,
      connected: patch.connected ?? false,
      account: patch.account ?? null,
      connectedAt: patch.connectedAt ?? null,
      lastSyncAt: patch.lastSyncAt ?? null,
      autoSync: patch.autoSync ?? false,
      syncIntervalHours: patch.syncIntervalHours ?? 4,
      config: patch.config ?? {},
    }))
    .returning();
  if (!created) throw new Error('integration insert failed');
  return created;
}

export async function connect(kind: IntegrationKind, input: ConnectIntegrationInput, whoId: string): Promise<Integration> {
  const row = await upsertIntegration(kind, {
    connected: true,
    account: input.account ?? `${kind}@allebrum.com`,
    connectedAt: new Date().toISOString().slice(0, 10),
    autoSync: input.autoSync ?? false,
    syncIntervalHours: input.syncIntervalHours ?? 4,
    config: (input.config ?? {}) as Integration['config'],
  });
  emit.toOrg(EV.INTEGRATION_UPDATED, { id: kind, by: whoId, at: new Date().toISOString(), kind });
  await appendActivity({ whoId, kind: 'integration.connect', target: `${kind} connected` });
  return row;
}

export async function disconnect(kind: IntegrationKind, whoId: string): Promise<Integration> {
  const row = await upsertIntegration(kind, { connected: false, account: null });
  emit.toOrg(EV.INTEGRATION_UPDATED, { id: kind, by: whoId, at: new Date().toISOString(), kind });
  await appendActivity({ whoId, kind: 'integration.disconnect', target: `${kind} disconnected` });
  return row;
}

export async function update(kind: IntegrationKind, patch: ConnectIntegrationInput, whoId: string): Promise<Integration> {
  const row = await upsertIntegration(kind, {
    account: patch.account,
    autoSync: patch.autoSync,
    syncIntervalHours: patch.syncIntervalHours,
    config: patch.config as Integration['config'] | undefined,
  });
  emit.toOrg(EV.INTEGRATION_UPDATED, { id: kind, by: whoId, at: new Date().toISOString(), kind });
  return row;
}

export async function syncDrive(whoId: string): Promise<Integration> {
  const row = await upsertIntegration('drive', { lastSyncAt: new Date().toISOString() });
  emit.toOrg(EV.INTEGRATION_UPDATED, { id: 'drive', by: whoId, at: new Date().toISOString(), kind: 'drive' });
  await appendActivity({ whoId, kind: 'integration.sync', target: 'Google Drive synced' });
  return row;
}

// ---- Drive folders / items ----
export async function listDriveFolders(): Promise<DriveFolder[]> {
  return db
    .select()
    .from(driveLinkedFolders)
    .where(tenantEq(driveLinkedFolders.tenantId))
    .orderBy(asc(driveLinkedFolders.drivePath));
}

export async function linkDriveFolder(input: LinkFolderInput, whoId: string): Promise<DriveFolder> {
  const [row] = await db
    .insert(driveLinkedFolders)
    .values(stampTenant({
      drivePath: input.drivePath,
      clientId: input.clientId,
      itemCount: input.itemCount,
      lastSync: new Date().toISOString(),
    }))
    .returning();
  if (!row) throw new Error('drive folder insert failed');
  emit.toOrg(EV.DRIVE_FOLDER_LINKED, { id: row.id, by: whoId, at: new Date().toISOString() });
  return row;
}

export async function unlinkDriveFolder(id: string, whoId: string): Promise<void> {
  const [row] = await db
    .delete(driveLinkedFolders)
    .where(and(eq(driveLinkedFolders.id, id), tenantEq(driveLinkedFolders.tenantId)))
    .returning({ id: driveLinkedFolders.id });
  if (!row) throw new HttpError(404, 'folder_not_found');
  emit.toOrg(EV.DRIVE_FOLDER_UNLINKED, { id: row.id, by: whoId, at: new Date().toISOString() });
}

export async function listDriveItems(folderId?: string): Promise<DriveItem[]> {
  if (folderId) {
    return db
      .select()
      .from(driveItems)
      .where(and(eq(driveItems.folderId, folderId), tenantEq(driveItems.tenantId)));
  }
  return db.select().from(driveItems).where(tenantEq(driveItems.tenantId));
}
