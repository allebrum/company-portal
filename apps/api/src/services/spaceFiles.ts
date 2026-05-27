import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { clients, projects } from '../db/schema.js';
import type { SpaceFile } from '@allebrum/shared';
import { HttpError } from '../middleware/errorHandler.js';
import {
  isConnected as driveIsConnected,
  ensureClientFolder,
  ensureProjectFolder,
  uploadFile,
  deleteEntry,
} from './drive.js';
import { emit } from '../realtime/emit.js';
import { EV } from '@allebrum/shared';
import { appendActivity } from './activity.js';

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
      .where(eq(clients.id, scopeId))
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
    .where(eq(projects.id, scopeId))
    .returning({ spaceFiles: projects.spaceFiles });
  if (!row) throw new HttpError(404, 'scope_not_found');
  return (row.spaceFiles as SpaceFile[]) ?? [];
}
