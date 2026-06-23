import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { clients, projects } from '../db/schema.js';
import type { SpaceFile } from '@modernzen/shared';
import { HttpError } from '../middleware/errorHandler.js';
import {
  isConnected as driveIsConnected,
  ensureClientFolder,
  ensureProjectFolder,
  uploadFile,
  deleteEntry,
  getFileMeta,
  renameEntry,
} from './drive.js';
import { emit } from '../realtime/emit.js';
import { EV } from '@modernzen/shared';
import { appendActivity } from './activity.js';
import { tenantEq } from '../tenancy/scope.js';

export type SpaceScopeKind = 'client' | 'project';

/**
 * Upload a file into a Client or Project Space's Drive folder AND append
 * the resulting `SpaceFile` to the row's `space_files` JSONB column —
 * atomically per-step so half-writes can't leak orphaned Drive files into
 * the bucket and persisted `space_files` always references a live Drive
 * resource.
 *
 * Why this exists: the previous flow was two browser-side API calls
 * (`POST /drive/upload` + `PATCH /clients/:id`), each with a different
 * permission gate. An admin with `media.manage` but not `clients.manage`
 * would see the Drive upload succeed and the spaceFiles append silently
 * 403, leaving the file visible in the Media dashboard but invisible in
 * the Client Space Files tab. Even with matching permissions, a tab
 * close or network blip between the two calls produced the same drift.
 *
 * One endpoint with one permission gate, two server-side steps in a
 * try/catch that trashes the just-uploaded Drive file on append failure.
 */
export async function uploadSpaceFile(args: {
  scopeKind: SpaceScopeKind;
  scopeId: string;
  whoId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ file: SpaceFile; spaceFiles: SpaceFile[] }> {
  if (!(await driveIsConnected())) {
    throw new HttpError(412, 'drive_not_connected');
  }

  // 1. Resolve the target Drive folder, lazily creating if missing.
  //    `ensureClientFolder` / `ensureProjectFolder` are race-safe (F17B).
  let folderId: string;
  if (args.scopeKind === 'client') {
    folderId = await ensureClientFolder(args.scopeId);
  } else {
    folderId = await ensureProjectFolder(args.scopeId);
  }

  // 2. Upload to Drive.
  const driveEntry = await uploadFile(folderId, args.filename, args.mimeType, args.buffer);

  // 3. Build the SpaceFile and atomically append to the row's JSONB
  //    column. The SQL `||` append eliminates the lost-update race that
  //    a read-modify-write at the application layer would have — two
  //    concurrent uploads to the same scope land cleanly side-by-side.
  const today = new Date().toISOString().slice(0, 10);
  const newFile: SpaceFile = {
    id: randomUUID(),
    kind: 'drive-doc',
    title: driveEntry.name,
    url: driveEntry.webViewLink ?? `https://drive.google.com/file/d/${driveEntry.id}/view`,
    meta: `Drive · ${driveEntry.id}`,
    source: 'files',
    addedBy: args.whoId,
    addedAt: today,
  };

  try {
    const result = await appendSpaceFile(args.scopeKind, args.scopeId, newFile);
    if (args.scopeKind === 'client') {
      emit.toOrg(EV.CLIENT_UPDATED, { id: args.scopeId, by: args.whoId, at: new Date().toISOString() });
    } else {
      emit.toOrg(EV.PROJECT_UPDATED, { id: args.scopeId, by: args.whoId, at: new Date().toISOString() });
    }
    await appendActivity({
      whoId: args.whoId,
      kind: 'space.file_uploaded',
      target: `${driveEntry.name} → ${args.scopeKind} space`,
    });
    return { file: newFile, spaceFiles: result };
  } catch (e) {
    // Append failed (scope was deleted, JSON ill-formed, etc). Trash
    // the Drive file we just created so we don't leave an orphan
    // behind that the user can't see in the Files tab and that
    // matches nothing in the DB.
    try { await deleteEntry(driveEntry.id); } catch { /* best-effort */ }
    throw e;
  }
}

/**
 * Atomic JSONB append on `space_files`. Uses Postgres' `||` operator —
 * concatenates the existing array with a one-element array literal in
 * a single UPDATE. Returns the resulting array so callers can echo it.
 */
async function appendSpaceFile(
  scopeKind: SpaceScopeKind,
  scopeId: string,
  newFile: SpaceFile,
): Promise<SpaceFile[]> {
  const oneElementArray = JSON.stringify([newFile]);
  if (scopeKind === 'client') {
    const [row] = await db
      .update(clients)
      .set({
        spaceFiles: sql`COALESCE(${clients.spaceFiles}, '[]'::jsonb) || ${oneElementArray}::jsonb`,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(clients.id, scopeId), tenantEq(clients.tenantId)))
      .returning({ spaceFiles: clients.spaceFiles });
    if (!row) throw new HttpError(404, 'scope_not_found');
    return (row.spaceFiles as SpaceFile[]) ?? [];
  }
  const [row] = await db
    .update(projects)
    .set({
      spaceFiles: sql`COALESCE(${projects.spaceFiles}, '[]'::jsonb) || ${oneElementArray}::jsonb`,
      updatedAt: new Date().toISOString(),
    })
    .where(and(eq(projects.id, scopeId), tenantEq(projects.tenantId)))
    .returning({ spaceFiles: projects.spaceFiles });
  if (!row) throw new HttpError(404, 'scope_not_found');
  return (row.spaceFiles as SpaceFile[]) ?? [];
}

async function getScopeFiles(scopeKind: SpaceScopeKind, scopeId: string): Promise<SpaceFile[]> {
  if (scopeKind === 'client') {
    const [row] = await db.select({ spaceFiles: clients.spaceFiles }).from(clients).where(eq(clients.id, scopeId)).limit(1);
    if (!row) throw new HttpError(404, 'scope_not_found');
    return (row.spaceFiles as SpaceFile[]) ?? [];
  }
  const [row] = await db.select({ spaceFiles: projects.spaceFiles }).from(projects).where(eq(projects.id, scopeId)).limit(1);
  if (!row) throw new HttpError(404, 'scope_not_found');
  return (row.spaceFiles as SpaceFile[]) ?? [];
}

async function replaceScopeFiles(scopeKind: SpaceScopeKind, scopeId: string, files: SpaceFile[]): Promise<SpaceFile[]> {
  if (scopeKind === 'client') {
    const [row] = await db
      .update(clients)
      .set({ spaceFiles: files as unknown as Record<string, unknown>, updatedAt: new Date().toISOString() })
      .where(eq(clients.id, scopeId))
      .returning({ spaceFiles: clients.spaceFiles });
    if (!row) throw new HttpError(404, 'scope_not_found');
    return (row.spaceFiles as SpaceFile[]) ?? [];
  }
  const [row] = await db
    .update(projects)
    .set({ spaceFiles: files as unknown as Record<string, unknown>, updatedAt: new Date().toISOString() })
    .where(eq(projects.id, scopeId))
    .returning({ spaceFiles: projects.spaceFiles });
  if (!row) throw new HttpError(404, 'scope_not_found');
  return (row.spaceFiles as SpaceFile[]) ?? [];
}

function extractDriveFileId(file: SpaceFile): string | null {
  const urlMatch = /\/d\/([a-zA-Z0-9_-]+)/.exec(file.url ?? '');
  if (urlMatch?.[1]) return urlMatch[1];
  const metaMatch = /^Drive\s*[.-]\s*([a-zA-Z0-9_-]+)$/i.exec((file.meta ?? '').trim());
  if (metaMatch?.[1]) return metaMatch[1];
  return null;
}

export async function renameSpaceFile(args: {
  scopeKind: SpaceScopeKind;
  scopeId: string;
  fileId: string;
  title: string;
  renameInDrive?: boolean;
  whoId: string;
}): Promise<{ file: SpaceFile; spaceFiles: SpaceFile[] }> {
  const nextTitle = args.title.trim();
  if (!nextTitle) throw new HttpError(400, 'title_required');

  const files = await getScopeFiles(args.scopeKind, args.scopeId);
  const idx = files.findIndex((f) => f.id === args.fileId);
  if (idx < 0) throw new HttpError(404, 'file_not_found');

  const current = files[idx]!;
  let resolvedTitle = nextTitle;
  if (args.renameInDrive !== false) {
    const driveId = extractDriveFileId(current);
    if (driveId) {
      const renamed = await renameEntry(driveId, nextTitle);
      resolvedTitle = renamed.name;
    }
  }

  const updatedFile: SpaceFile = { ...current, title: resolvedTitle };
  const next = files.slice();
  next[idx] = updatedFile;
  const spaceFiles = await replaceScopeFiles(args.scopeKind, args.scopeId, next);

  if (args.scopeKind === 'client') {
    emit.toOrg(EV.CLIENT_UPDATED, { id: args.scopeId, by: args.whoId, at: new Date().toISOString() });
  } else {
    emit.toOrg(EV.PROJECT_UPDATED, { id: args.scopeId, by: args.whoId, at: new Date().toISOString() });
  }

  return { file: updatedFile, spaceFiles };
}

export async function refreshSpaceFileNamesFromDrive(args: {
  scopeKind: SpaceScopeKind;
  scopeId: string;
  whoId: string;
}): Promise<{ updated: number; spaceFiles: SpaceFile[] }> {
  if (!(await driveIsConnected())) {
    throw new HttpError(412, 'drive_not_connected');
  }

  const files = await getScopeFiles(args.scopeKind, args.scopeId);
  let updated = 0;
  const next = await Promise.all(files.map(async (file) => {
    const driveId = extractDriveFileId(file);
    if (!driveId) return file;
    try {
      const meta = await getFileMeta(driveId);
      const driveName = (meta.name ?? '').trim();
      if (!driveName || driveName === file.title) return file;
      updated += 1;
      return { ...file, title: driveName };
    } catch {
      return file;
    }
  }));

  if (updated === 0) {
    return { updated: 0, spaceFiles: files };
  }

  const spaceFiles = await replaceScopeFiles(args.scopeKind, args.scopeId, next);
  if (args.scopeKind === 'client') {
    emit.toOrg(EV.CLIENT_UPDATED, { id: args.scopeId, by: args.whoId, at: new Date().toISOString() });
  } else {
    emit.toOrg(EV.PROJECT_UPDATED, { id: args.scopeId, by: args.whoId, at: new Date().toISOString() });
  }
  return { updated, spaceFiles };
}
