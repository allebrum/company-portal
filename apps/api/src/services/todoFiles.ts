import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { todos } from '../db/schema.js';
import type { SpaceFile } from '@modernzen/shared';
import { HttpError } from '../middleware/errorHandler.js';
import { uploadObject, deleteObject } from './storage.js';
import { emit } from '../realtime/emit.js';
import { EV } from '@modernzen/shared';
import { appendActivity } from './activity.js';
import { tenantEq } from '../tenancy/scope.js';
import { currentTenantId } from '../tenancy/context.js';

/**
 * F25: upload a file to Supabase Storage and atomically append a `SpaceFile` to
 * the `todos.attachments` JSONB array. Same atomic-step shape as
 * `spaceFiles.ts:uploadSpaceFile` — the Storage object is deleted if the JSONB
 * append fails. Unlike the Drive era, a todo no longer needs a parent
 * project/client folder; the object is keyed under the todo itself.
 */
export async function uploadTodoFile(args: {
  todoId: string;
  whoId: string;
  filename: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<{ file: SpaceFile; attachments: SpaceFile[] }> {
  const [todo] = await db
    .select({ id: todos.id, projectId: todos.projectId, clientId: todos.clientId, title: todos.title })
    .from(todos)
    .where(and(eq(todos.id, args.todoId), tenantEq(todos.tenantId)))
    .limit(1);
  if (!todo) throw new HttpError(404, 'todo_not_found');

  const stored = await uploadObject({
    tenantId: currentTenantId(),
    scopeKind: 'todo',
    scopeId: args.todoId,
    filename: args.filename,
    mimeType: args.mimeType,
    buffer: args.buffer,
  });

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
      target: `${args.filename} → ${todo.title}`,
    });

    return { file: newFile, attachments };
  } catch (e) {
    await deleteObject(stored.key);
    throw e;
  }
}
