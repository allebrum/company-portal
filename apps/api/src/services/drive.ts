import { Readable } from 'node:stream';
import { google, type drive_v3 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { eq, desc } from 'drizzle-orm';
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
 * Resolve the Drive folder ID that uploads for `projectId` should land in.
 * If the project already has a `driveFolderId`, returns it. Otherwise lazily
 * creates the (client folder if missing → project folder) chain inside the
 * shared portal root and persists the IDs. Requires Drive to be connected;
 * callers should check `isConnected()` first if they want a softer failure.
 */
export async function ensureProjectFolder(projectId: string): Promise<string> {
  const [proj] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!proj) throw new HttpError(404, 'project_not_found');
  if (proj.driveFolderId) return proj.driveFolderId;

  const [client] = await db.select().from(clients).where(eq(clients.id, proj.clientId)).limit(1);
  if (!client) throw new HttpError(404, 'client_not_found');

  // Lazy-backfill the client folder first if it's missing.
  let clientFolderId = client.driveFolderId;
  if (!clientFolderId) {
    const rootId = await ensureSharedFolder();
    const folder = await createFolder(rootId, client.name);
    clientFolderId = folder.id;
    await db
      .update(clients)
      .set({ driveFolderId: clientFolderId, updatedAt: new Date().toISOString() })
      .where(eq(clients.id, client.id));
  }

  // Now create the project folder inside it.
  const projectFolder = await createFolder(clientFolderId, proj.name);
  await db
    .update(projects)
    .set({ driveFolderId: projectFolder.id, updatedAt: new Date().toISOString() })
    .where(eq(projects.id, proj.id));
  return projectFolder.id;
}
