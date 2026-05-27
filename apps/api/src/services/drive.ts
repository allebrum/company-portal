import { Readable } from 'node:stream';
import { google, type drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { eq, and, desc, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { oauthTokens, appSettings, clients, projects } from '../db/schema.js';
import { getSettings } from './settings.js';
import { env, driveRedirectUrl, driveOAuthConfigured } from '../env.js';
import { HttpError } from '../middleware/errorHandler.js';

const PROVIDER = 'google_drive';
export const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive'];
const FOLDER_MIME = 'application/vnd.google-apps.folder';

export function driveConfigured(): boolean {
  return driveOAuthConfigured;
}

function oauthClient(): OAuth2Client {
  if (!driveOAuthConfigured) throw new Error('drive_oauth_not_configured');
  return new OAuth2Client(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET, driveRedirectUrl);
}

export function buildDriveConsentUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: DRIVE_SCOPES,
    state,
  });
}

async function getStoredToken() {
  const rows = await db
    .select()
    .from(oauthTokens)
    .where(eq(oauthTokens.provider, PROVIDER))
    .orderBy(desc(oauthTokens.updatedAt))
    .limit(1);
  return rows[0];
}

export async function isConnected(): Promise<boolean> {
  const t = await getStoredToken();
  return !!t?.refreshToken;
}

export async function getDriveStatus() {
  const [token, settings] = await Promise.all([getStoredToken(), getSettings()]);
  return {
    configured: driveOAuthConfigured,
    connected: !!token?.refreshToken,
    account: token?.scopes ? (token.refreshToken ? 'connected' : null) : null,
    sharedFolderId: settings.portalSharedFolderId,
    lastConnectedAt: token?.updatedAt ?? null,
  };
}

export async function saveDriveToken(
  userId: string,
  tokens: { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null },
): Promise<void> {
  await db
    .insert(oauthTokens)
    .values({
      userId,
      provider: PROVIDER,
      scopes: DRIVE_SCOPES,
      accessToken: tokens.access_token ?? null,
      refreshToken: tokens.refresh_token ?? null,
      expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    })
    .onConflictDoUpdate({
      target: [oauthTokens.userId, oauthTokens.provider],
      set: {
        scopes: DRIVE_SCOPES,
        accessToken: tokens.access_token ?? null,
        // Google omits refresh_token on re-consent sometimes; keep the old one.
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        updatedAt: new Date().toISOString(),
      },
    });
}

export async function exchangeDriveCode(code: string) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

export async function disconnectDrive(): Promise<void> {
  await db.delete(oauthTokens).where(eq(oauthTokens.provider, PROVIDER));
}

async function driveApi(): Promise<drive_v3.Drive> {
  const token = await getStoredToken();
  if (!token?.refreshToken) throw new Error('drive_not_connected');
  const client = oauthClient();
  client.setCredentials({
    refresh_token: token.refreshToken,
    access_token: token.accessToken ?? undefined,
    expiry_date: token.expiry ? new Date(token.expiry).getTime() : undefined,
  });
  return google.drive({ version: 'v3', auth: client });
}

/** Returns the configured shared folder, creating it on first use. */
export async function ensureSharedFolder(): Promise<string> {
  const settings = await getSettings();
  const drive = await driveApi();
  if (settings.portalSharedFolderId) {
    try {
      await drive.files.get({ fileId: settings.portalSharedFolderId, fields: 'id, trashed' });
      return settings.portalSharedFolderId;
    } catch {
      /* fall through and recreate */
    }
  }
  const created = await drive.files.create({
    requestBody: { name: 'Allebrum Portal', mimeType: FOLDER_MIME },
    fields: 'id',
  });
  const id = created.data.id!;
  await db
    .update(appSettings)
    .set({ portalSharedFolderId: id, updatedAt: new Date().toISOString() })
    .where(eq(appSettings.id, 'singleton'));
  return id;
}

export type DriveEntry = {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  iconLink?: string | null;
  webViewLink?: string | null;
  modifiedTime?: string | null;
  size?: string | null;
};

export async function listFolder(folderId: string): Promise<DriveEntry[]> {
  const drive = await driveApi();
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id,name,mimeType,iconLink,webViewLink,modifiedTime,size)',
    orderBy: 'folder,name',
    pageSize: 200,
  });
  return (res.data.files ?? []).map((f) => ({
    id: f.id!,
    name: f.name ?? 'Untitled',
    mimeType: f.mimeType ?? '',
    isFolder: f.mimeType === FOLDER_MIME,
    iconLink: f.iconLink,
    webViewLink: f.webViewLink,
    modifiedTime: f.modifiedTime,
    size: f.size,
  }));
}

/** Breadcrumb from the shared root down to folderId (inclusive). */
export async function folderPath(folderId: string): Promise<{ id: string; name: string }[]> {
  const drive = await driveApi();
  const root = await ensureSharedFolder();
  const chain: { id: string; name: string }[] = [];
  let current: string | undefined = folderId;
  let guard = 0;
  while (current && guard++ < 25) {
    const meta: { data: drive_v3.Schema$File } = await drive.files.get({
      fileId: current,
      fields: 'id,name,parents',
    });
    chain.unshift({ id: meta.data.id!, name: meta.data.name ?? '' });
    if (meta.data.id === root) break;
    current = meta.data.parents?.[0] ?? undefined;
  }
  return chain;
}

export async function createFolder(parentId: string, name: string): Promise<DriveEntry> {
  const drive = await driveApi();
  const res = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: 'id,name,mimeType,webViewLink,modifiedTime',
  });
  const f = res.data;
  return {
    id: f.id!,
    name: f.name ?? name,
    mimeType: FOLDER_MIME,
    isFolder: true,
    webViewLink: f.webViewLink,
    modifiedTime: f.modifiedTime,
  };
}

export async function uploadFile(
  parentId: string,
  filename: string,
  mimeType: string,
  buffer: Buffer,
): Promise<DriveEntry> {
  const drive = await driveApi();
  const res = await drive.files.create({
    requestBody: { name: filename, parents: [parentId] },
    media: { mimeType: mimeType || 'application/octet-stream', body: Readable.from(buffer) },
    fields: 'id,name,mimeType,webViewLink,modifiedTime,size',
  });
  const f = res.data;
  return {
    id: f.id!,
    name: f.name ?? filename,
    mimeType: f.mimeType ?? mimeType,
    isFolder: false,
    webViewLink: f.webViewLink,
    modifiedTime: f.modifiedTime,
    size: f.size,
  };
}

export async function getFileMeta(fileId: string) {
  const drive = await driveApi();
  const res = await drive.files.get({ fileId, fields: 'id,name,mimeType,size' });
  return res.data;
}

export async function downloadFile(fileId: string): Promise<NodeJS.ReadableStream> {
  const drive = await driveApi();
  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  return res.data as unknown as NodeJS.ReadableStream;
}

export async function deleteEntry(fileId: string): Promise<void> {
  const drive = await driveApi();
  await drive.files.update({ fileId, requestBody: { trashed: true } });
}

/**
 * Search a parent folder for non-trashed sub-folders whose name matches
 * exactly. Returns oldest-first so callers picking a canonical folder
 * from a duplicate set get a predictable winner.
 *
 * Escapes single quotes per Drive's `q=` syntax (the only character we
 * need to worry about for folder name matching).
 */
async function findFoldersByName(parentId: string, name: string): Promise<drive_v3.Schema$File[]> {
  const drive = await driveApi();
  const safeName = name.replace(/'/g, "\\'");
  const res = await drive.files.list({
    q: `'${parentId}' in parents and name = '${safeName}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: 'files(id,name,createdTime)',
    orderBy: 'createdTime',
    pageSize: 50,
  });
  return res.data.files ?? [];
}

/** Quick existence/trashed check — `files.get` throws if the ID is unknown. */
async function folderIsLive(fileId: string): Promise<boolean> {
  const drive = await driveApi();
  try {
    const res = await drive.files.get({ fileId, fields: 'id, trashed' });
    return res.data?.trashed !== true;
  } catch {
    return false;
  }
}

export type ReconciliationReport = {
  /** Clients whose linked folder was missing/trashed in Drive; cleared to null. */
  clearedMissing: Array<{ scope: 'client' | 'project'; id: string; name: string; staleFolderId: string }>;
  /** Clients/projects whose `driveFolderId` was null and we linked to a same-named folder in the parent. */
  linked: Array<{ scope: 'client' | 'project'; id: string; name: string; folderId: string }>;
  /** Same-named folders that exist but weren't picked — admin should review and trash manually. */
  duplicatesDetected: Array<{
    scope: 'client' | 'project'; id: string; name: string; canonicalFolderId: string; duplicateFolderIds: string[];
  }>;
  /** Folders in the shared root that aren't pointed to by any client. */
  unlinkedFolders: Array<{ folderId: string; name: string }>;
  /** Same, one level down — folders inside any client folder that aren't pointed to by any project. */
  unlinkedProjectFolders: Array<{ folderId: string; name: string; clientFolderId: string; clientName: string }>;
};

/**
 * Walks every client and project against Drive: cleans dangling
 * `driveFolderId` pointers, links rows that have a name-matching folder
 * available, and reports duplicates / orphans so the admin can clean up
 * Drive directly. Idempotent — re-running is harmless.
 *
 * Does NOT auto-trash duplicate folders: a folder might have files an
 * admin wants to keep. We surface the IDs so the user can decide.
 */
export async function reconcileFolders(): Promise<ReconciliationReport> {
  const report: ReconciliationReport = {
    clearedMissing: [],
    linked: [],
    duplicatesDetected: [],
    unlinkedFolders: [],
    unlinkedProjectFolders: [],
  };

  const rootId = await ensureSharedFolder();
  const now = () => new Date().toISOString();

  const allClients = await db.select().from(clients);
  const allProjects = await db.select().from(projects);

  // --- Clients pass ---
  // 1) Clear dangling pointers (folder deleted in Drive UI).
  for (const c of allClients) {
    if (!c.driveFolderId) continue;
    const live = await folderIsLive(c.driveFolderId);
    if (!live) {
      report.clearedMissing.push({ scope: 'client', id: c.id, name: c.name, staleFolderId: c.driveFolderId });
      await db
        .update(clients)
        .set({ driveFolderId: null, updatedAt: now() })
        .where(eq(clients.id, c.id));
    }
  }

  // 2) For clients with null pointer, search the shared root for a same-named folder.
  const clientsAfter = await db.select().from(clients);
  for (const c of clientsAfter) {
    if (c.driveFolderId) continue;
    const matches = await findFoldersByName(rootId, c.name);
    if (matches.length === 0) continue; // nothing to link — will be lazy-created on next upload
    const canonical = matches[0]!;
    await db
      .update(clients)
      .set({ driveFolderId: canonical.id!, updatedAt: now() })
      .where(and(eq(clients.id, c.id), isNull(clients.driveFolderId)));
    report.linked.push({ scope: 'client', id: c.id, name: c.name, folderId: canonical.id! });
    if (matches.length > 1) {
      report.duplicatesDetected.push({
        scope: 'client',
        id: c.id,
        name: c.name,
        canonicalFolderId: canonical.id!,
        duplicateFolderIds: matches.slice(1).map((m) => m.id!),
      });
    }
  }

  // --- Projects pass ---
  // 1) Clear dangling project pointers.
  for (const p of allProjects) {
    if (!p.driveFolderId) continue;
    const live = await folderIsLive(p.driveFolderId);
    if (!live) {
      report.clearedMissing.push({ scope: 'project', id: p.id, name: p.name, staleFolderId: p.driveFolderId });
      await db
        .update(projects)
        .set({ driveFolderId: null, updatedAt: now() })
        .where(eq(projects.id, p.id));
    }
  }

  // 2) For projects with null pointer, search their parent client folder.
  const projectsAfter = await db.select().from(projects);
  const clientsById = new Map(
    (await db.select().from(clients)).map((c) => [c.id, c]),
  );
  for (const p of projectsAfter) {
    if (p.driveFolderId) continue;
    const parent = clientsById.get(p.clientId);
    if (!parent?.driveFolderId) continue; // can't link without a parent folder
    const matches = await findFoldersByName(parent.driveFolderId, p.name);
    if (matches.length === 0) continue;
    const canonical = matches[0]!;
    await db
      .update(projects)
      .set({ driveFolderId: canonical.id!, updatedAt: now() })
      .where(and(eq(projects.id, p.id), isNull(projects.driveFolderId)));
    report.linked.push({ scope: 'project', id: p.id, name: p.name, folderId: canonical.id! });
    if (matches.length > 1) {
      report.duplicatesDetected.push({
        scope: 'project',
        id: p.id,
        name: p.name,
        canonicalFolderId: canonical.id!,
        duplicateFolderIds: matches.slice(1).map((m) => m.id!),
      });
    }
  }

  // --- Orphan scan ---
  // Shared root → list folders → any not pointed-to by a client is an orphan.
  const finalClients = await db.select().from(clients);
  const finalProjects = await db.select().from(projects);
  const claimedClientFolders = new Set(
    finalClients.map((c) => c.driveFolderId).filter((x): x is string => !!x),
  );
  const rootEntries = await listFolder(rootId);
  for (const e of rootEntries) {
    if (!e.isFolder) continue;
    if (!claimedClientFolders.has(e.id)) {
      report.unlinkedFolders.push({ folderId: e.id, name: e.name });
    }
  }

  // Sub-orphans: folders inside each client folder that aren't pointed to by a project.
  const claimedProjectFolders = new Set(
    finalProjects.map((p) => p.driveFolderId).filter((x): x is string => !!x),
  );
  for (const c of finalClients) {
    if (!c.driveFolderId) continue;
    const subEntries = await listFolder(c.driveFolderId);
    for (const e of subEntries) {
      if (!e.isFolder) continue;
      if (!claimedProjectFolders.has(e.id)) {
        report.unlinkedProjectFolders.push({
          folderId: e.id,
          name: e.name,
          clientFolderId: c.driveFolderId,
          clientName: c.name,
        });
      }
    }
  }

  return report;
}

/**
 * Resolve the Drive folder ID for a client, creating one inside the shared
 * portal root if it doesn't exist yet. Race-safe: if two callers find the
 * row's `driveFolderId` null at the same time and both create Drive folders,
 * only one's conditional UPDATE succeeds — the other trashes its just-
 * created folder and returns the winner's ID. This is the only safe way to
 * lazy-create folders without leaving orphans every time two uploads race.
 *
 * Requires Drive to be connected; callers should check `isConnected()` first
 * if they want a softer failure.
 */
export async function ensureClientFolder(clientId: string): Promise<string> {
  const [client] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  if (!client) throw new HttpError(404, 'client_not_found');
  if (client.driveFolderId) return client.driveFolderId;

  const rootId = await ensureSharedFolder();
  const folder = await createFolder(rootId, client.name);

  // Conditional write — only succeeds if `driveFolderId` is STILL null. If
  // another request beat us, no rows are returned; trash our orphan, then
  // re-read and return the canonical value.
  const written = await db
    .update(clients)
    .set({ driveFolderId: folder.id, updatedAt: new Date().toISOString() })
    .where(and(eq(clients.id, clientId), isNull(clients.driveFolderId)))
    .returning({ driveFolderId: clients.driveFolderId });

  if (written.length === 0) {
    try { await deleteEntry(folder.id); } catch { /* best-effort orphan cleanup */ }
    const [winner] = await db
      .select({ driveFolderId: clients.driveFolderId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (!winner?.driveFolderId) throw new Error('client_folder_race_unresolved');
    return winner.driveFolderId;
  }
  return folder.id;
}

/**
 * Resolve the Drive folder ID that uploads for `projectId` should land in.
 * Lazily creates the (client folder if missing → project folder) chain
 * inside the shared portal root and persists the IDs. Race-safe at every
 * step via `ensureClientFolder` + a matching conditional UPDATE on the
 * project row. Requires Drive to be connected.
 */
export async function ensureProjectFolder(projectId: string): Promise<string> {
  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!proj) throw new HttpError(404, 'project_not_found');
  if (proj.driveFolderId) return proj.driveFolderId;

  const clientFolderId = await ensureClientFolder(proj.clientId);

  // Create the project folder, then conditionally claim it on the row.
  // Same race-safe pattern as ensureClientFolder above.
  const folder = await createFolder(clientFolderId, proj.name);
  const written = await db
    .update(projects)
    .set({ driveFolderId: folder.id, updatedAt: new Date().toISOString() })
    .where(and(eq(projects.id, projectId), isNull(projects.driveFolderId)))
    .returning({ driveFolderId: projects.driveFolderId });

  if (written.length === 0) {
    try { await deleteEntry(folder.id); } catch { /* best-effort orphan cleanup */ }
    const [winner] = await db
      .select({ driveFolderId: projects.driveFolderId })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (!winner?.driveFolderId) throw new Error('project_folder_race_unresolved');
    return winner.driveFolderId;
  }
  return folder.id;
}
