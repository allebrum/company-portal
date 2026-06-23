import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { todos } from '../db/schema.js';
import type { SpaceFile } from '@modernzen/shared';
import { HttpError } from '../middleware/errorHandler.js';
import {
  isConnected as driveIsConnected,
  ensureClientFolder,
  ensureProjectFolder,
  uploadFile,
  deleteEntry,
} from './drive.js';
import { emit } from '../realtime/emit.js';
import { EV } from '@modernzen/shared';
import { appendActivity } from './activity.js';
import { tenantEq } from '../tenancy/scope.js';

/**
 * F25: upload a file into the Drive folder that the todo's parent
 * project / client owns, then atomically append a `SpaceFile` to the
 * `todos.attachments` JSONB array. Same atomic-step shape as
 * `spaceFiles.ts:uploadSpaceFile` — half-writes are prevented by
 * trashing the Drive file if the JSONB append fails.
 *
 * Resolution rule:
 *  - If the todo has a `projectId`, the file lands in that project's
 *    Drive folder (`ensureProjectFolder`).
 *  - Else if it has a `clientId`, falls back to the client's folder
 *    (`ensureClientFolder`).
 *  - Else the upload is rejected (412 `no_parent_scope`) — there's no
 *    obvious folder to put the file in. Editing the todo to attach a
 *    project/client first is the recovery path.
 */
export async function uploadTodoFile(args: {
  todoId: string;
  whoId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ file: SpaceFile; attachments: SpaceFile[] }> {
  if (!(await driveIsConnected())) {
    throw new HttpError(412, 'drive_not_connected');
  }

  const [todo] = await db
    .select({ id: todos.id, projectId: todos.projectId, clientId: todos.clientId, title: todos.title })
    .from(todos)
    .where(and(eq(todos.id, args.todoId), tenantEq(todos.tenantId)))
    .limit(1);
  if (!todo) throw new HttpError(404, 'todo_not_found');

  // Resolve target folder via parent scope. Both helpers are race-safe
  // (F17B) and lazy-create up the chain if needed.
  let folderId: string;
  if (todo.projectId) {
    folderId = await ensureProjectFolder(todo.projectId);
  } else if (todo.clientId) {
    folderId = await ensureClientFolder(todo.clientId);
  } else {
    throw new HttpError(412, 'no_parent_scope');
  }

  const driveEntry = await uploadFile(folderId, args.filename, args.mimeType, args.buffer);

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
    const oneElementArray = JSON.stringify([newFile]);
    const [row] = await db
      .update(todos)
      .set({
        attachments: sql`COALESCE(${todos.attachments}, '[]'::jsonb) || ${oneElementArray}::jsonb`,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(todos.id, args.todoId), tenantEq(todos.tenantId)))
      .returning({ attachments: todos.attachments });
    if (!row) throw new HttpError(404, 'todo_not_found');
    const attachments = (row.attachments as SpaceFile[]) ?? [];

    emit.toOrg(EV.TODO_UPDATED, { id: args.todoId, by: args.whoId, at: new Date().toISOString() });
    await appendActivity({
      whoId: args.whoId,
      kind: 'todo.file_uploaded',
      target: `${driveEntry.name} → ${todo.title}`,
    });

    return { file: newFile, attachments };
  } catch (e) {
    // Append failed — orphan the Drive file we just created.
    try { await deleteEntry(driveEntry.id); } catch { /* best-effort */ }
    throw e;
  }
}
