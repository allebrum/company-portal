import { eq, or, and, desc, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { todos, type Todo } from '../db/schema.js';
import type { CreateTodoInput, UpdateTodoInput } from '@allebrum/shared';
import { EV } from '@allebrum/shared';
import { emit } from '../realtime/emit.js';
import { appendActivity } from './activity.js';
import { HttpError } from '../middleware/errorHandler.js';
import { tenantEq, stampTenant } from '../tenancy/scope.js';

/** Returns all todos visible to viewerId — public ones + private ones assigned to viewer. */
export async function listVisibleTodos(viewerId: string): Promise<Todo[]> {
  return db
    .select()
    .from(todos)
    .where(and(tenantEq(todos.tenantId), or(eq(todos.private, false), eq(todos.assigneeId, viewerId))))
    .orderBy(desc(todos.createdAt));
}

export async function getTodo(id: string): Promise<Todo | undefined> {
  const rows = await db
    .select()
    .from(todos)
    .where(and(eq(todos.id, id), tenantEq(todos.tenantId)))
    .limit(1);
  return rows[0];
}

function emitTodo(
  event: 'created' | 'updated' | 'deleted',
  todo: Pick<Todo, 'id' | 'private' | 'assigneeId'>,
  whoId: string,
): void {
  const evName =
    event === 'created' ? EV.TODO_CREATED : event === 'updated' ? EV.TODO_UPDATED : EV.TODO_DELETED;
  const payload = { id: todo.id, by: whoId, at: new Date().toISOString() };
  if (todo.private && todo.assigneeId) {
    emit.toUser(todo.assigneeId, evName, payload);
  } else {
    emit.toOrg(evName, payload);
  }
}

export async function createTodo(input: CreateTodoInput, whoId: string): Promise<Todo> {
  // F25: an assignee is EITHER a user OR a group. If neither is provided we
  // default the assignee to the creator (existing behavior). If a group is
  // provided, leave assigneeId null so the XOR CHECK holds.
  const assigneeId =
    input.assigneeGroupId != null
      ? null
      : (input.assigneeId ?? whoId);
  const [row] = await db
    .insert(todos)
    .values(stampTenant({
      title: input.title,
      description: input.description ?? null,
      assigneeId,
      assigneeGroupId: input.assigneeGroupId ?? null,
      clientId: input.clientId ?? null,
      projectId: input.projectId ?? null,
      goalId: input.goalId ?? null,
      dueDate: input.dueDate ?? null,
      estimateMin: input.estimateMin,
      priority: input.priority,
      tags: input.tags,
      private: input.private,
      checklist: input.checklist,
      attachments: input.attachments ?? [],
    }))
    .returning();
  if (!row) throw new Error('todo insert failed');
  emitTodo('created', row, whoId);
  await appendActivity({ whoId, kind: 'todo.create', target: row.title });
  return row;
}

export async function updateTodo(id: string, patch: UpdateTodoInput, whoId: string): Promise<Todo> {
  const before = await getTodo(id);
  if (!before) throw new HttpError(404, 'todo_not_found');

  const upd: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.title !== undefined) upd.title = patch.title;
  if (patch.description !== undefined) upd.description = patch.description;
  // F25: setting one of (assigneeId, assigneeGroupId) clears the other so
  // the DB XOR CHECK is satisfied without requiring callers to know.
  if (patch.assigneeId !== undefined) {
    upd.assigneeId = patch.assigneeId;
    if (patch.assigneeId != null) upd.assigneeGroupId = null;
  }
  if (patch.assigneeGroupId !== undefined) {
    upd.assigneeGroupId = patch.assigneeGroupId;
    if (patch.assigneeGroupId != null) upd.assigneeId = null;
  }
  if (patch.clientId !== undefined) upd.clientId = patch.clientId;
  if (patch.projectId !== undefined) upd.projectId = patch.projectId;
  if (patch.goalId !== undefined) upd.goalId = patch.goalId;
  if (patch.dueDate !== undefined) upd.dueDate = patch.dueDate;
  if (patch.estimateMin !== undefined) upd.estimateMin = patch.estimateMin;
  if (patch.loggedMin !== undefined) upd.loggedMin = patch.loggedMin;
  if (patch.priority !== undefined) upd.priority = patch.priority;
  if (patch.tags !== undefined) upd.tags = patch.tags;
  if (patch.private !== undefined) upd.private = patch.private;
  if (patch.status !== undefined) upd.status = patch.status;
  if (patch.checklist !== undefined) upd.checklist = patch.checklist;
  if (patch.attachments !== undefined) upd.attachments = patch.attachments;

  const [row] = await db
    .update(todos)
    .set(upd)
    .where(and(eq(todos.id, id), tenantEq(todos.tenantId)))
    .returning();
  if (!row) throw new HttpError(404, 'todo_not_found');

  // If private flipped or assignee changed, emit to all impacted parties.
  const oldAssignee = before.assigneeId;
  const newAssignee = row.assigneeId;
  if (before.private || row.private) {
    const recipients = new Set<string>();
    if (oldAssignee) recipients.add(oldAssignee);
    if (newAssignee) recipients.add(newAssignee);
    const payload = { id: row.id, by: whoId, at: new Date().toISOString() };
    if (!row.private) {
      // became public — broadcast org-wide plus prior private viewer(s)
      emit.toOrg(EV.TODO_UPDATED, payload);
    } else {
      emit.toUsers([...recipients], EV.TODO_UPDATED, payload);
    }
  } else {
    emitTodo('updated', row, whoId);
  }
  return row;
}

export async function toggleTodo(id: string, whoId: string): Promise<Todo> {
  const before = await getTodo(id);
  if (!before) throw new HttpError(404, 'todo_not_found');
  const next = before.status === 'done' ? 'open' : 'done';
  const [row] = await db
    .update(todos)
    .set({ status: next, updatedAt: new Date().toISOString() })
    .where(and(eq(todos.id, id), tenantEq(todos.tenantId)))
    .returning();
  if (!row) throw new HttpError(404, 'todo_not_found');
  emitTodo('updated', row, whoId);
  if (next === 'done') {
    await appendActivity({ whoId, kind: 'todo.done', target: row.title });
  }
  return row;
}

export async function deleteTodo(id: string, whoId: string): Promise<void> {
  const [row] = await db.delete(todos).where(and(eq(todos.id, id), tenantEq(todos.tenantId))).returning({
    id: todos.id,
    private: todos.private,
    assigneeId: todos.assigneeId,
  });
  if (!row) throw new HttpError(404, 'todo_not_found');
  emitTodo('deleted', row, whoId);
}

/** Increments loggedMin on a todo (used when a timer with todoId stops). */
export async function logTimeToTodo(id: string, addMin: number): Promise<void> {
  await db
    .update(todos)
    .set({ loggedMin: sql`${todos.loggedMin} + ${addMin}`, updatedAt: new Date().toISOString() })
    .where(and(eq(todos.id, id), tenantEq(todos.tenantId)));
}
