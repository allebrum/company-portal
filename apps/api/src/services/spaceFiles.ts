import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { clients, projects } from '../db/schema.js';
import type { SpaceFile } from '@modernzen/shared';
import { HttpError } from '../middleware/errorHandler.js';
import { uploadObject, deleteObject } from './storage.js';
import { emit } from '../realtime/emit.js';
import { EV } from '@modernzen/shared';
import { appendActivity } from './activity.js';
import { tenantEq } from '../tenancy/scope.js';
import { currentTenantId } from '../tenancy/context.js';

export type SpaceScopeKind = 'client' | 'project';

/**
 * Upload a file into a Client or Project Space (Supabase Storage) AND append
 * the resulting `SpaceFile` to the row's `space_files` JSONB column — atomically
 * per-step so a half-write can't leave an orphaned Storage object, and persisted
 * `space_files` always references a live object.
 *
 * One endpoint, one permission gate, two server-side steps in a try/catch that
 * deletes the just-uploaded Storage object on append failure. (No Google Drive
 * connection required — uploads work as soon as Supabase Storage is configured.)
 */
export async function uploadSpaceFile(args: {
  scopeKind: SpaceScopeKind;
  scopeId: string;
  whoId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ file: SpaceFile; spaceFiles: SpaceFile[] }> {
  // 1. Upload the bytes to the tenant/scope-keyed Storage path.
  const stored = await uploadObject({
    tenantId: currentTenantId(),
    scopeKind: args.scopeKind,
    scopeId: args.scopeId,
    filename: args.filename,
    mimeType: args.mimeType,
    buffer: args.buffer,
  });

  // 2. Build the SpaceFile and atomically append to the row's JSONB column.
  //    The SQL `||` append eliminates the lost-update race of an app-layer
  //    read-modify-write — concurrent uploads land cleanly side-by-side.
  const today = new Date().toISOString().slice(0, 10);
  const newFile: SpaceFile = {
    id: randomUUID(),
    kind: 'drive-doc',
    title: args.filename,
    url: stored.url,
    meta: `Storage · ${args.filename}`,
    source: 'files',
    addedBy: args.whoId,
    addedAt: today,
    storageKey: stored.key,
    mimeType: args.mimeType || undefined,
    sizeBytes: stored.size,
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
      target: `${args.filename} → ${args.scopeKind} space`,
    });
    return { file: newFile, spaceFiles: result };
  } catch (e) {
    // Append failed (scope deleted, JSON ill-formed, etc). Delete the object
    // we just stored so we don't leave an orphan with no DB reference.
    await deleteObject(stored.key);
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

export async function renameSpaceFile(args: {
  scopeKind: SpaceScopeKind;
  scopeId: string;
  fileId: string;
  title: string;
  /** Legacy flag (Drive era); ignored now — Storage objects aren't renamed in place. */
  renameInDrive?: boolean;
  whoId: string;
}): Promise<{ file: SpaceFile; spaceFiles: SpaceFile[] }> {
  const nextTitle = args.title.trim();
  if (!nextTitle) throw new HttpError(400, 'title_required');

  const files = await getScopeFiles(args.scopeKind, args.scopeId);
  const idx = files.findIndex((f) => f.id === args.fileId);
  if (idx < 0) throw new HttpError(404, 'file_not_found');

  const current = files[idx]!;
  // The Storage object key is immutable; renaming only updates the display title.
  const updatedFile: SpaceFile = { ...current, title: nextTitle };
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
  // Supabase Storage has no external rename source — file names are owned in-app.
  // Kept as a no-op so the existing route/UI "refresh names" button degrades
  // gracefully instead of 404-ing.
  const files = await getScopeFiles(args.scopeKind, args.scopeId);
  return { updated: 0, spaceFiles: files };
}
