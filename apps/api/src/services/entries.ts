import { eq, and, or, gte, lte, inArray, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  timeEntries,
  activeTimers,
  type TimeEntry,
  type ActiveTimer,
} from '../db/schema.js';
import type {
  StartTimerInput,
  ManualEntryInput,
  EntryListQuery,
} from '@allebrum/shared';
import { EV } from '@allebrum/shared';
import { emit } from '../realtime/emit.js';
import { appendActivity } from './activity.js';
import { getTodo, logTimeToTodo } from './todos.js';
import { periodForDate } from './payPeriods.js';
import { HttpError } from '../middleware/errorHandler.js';

function minutesBetween(startIso: string, endIso: string): number {
  return Math.max(1, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
}

// ---- Timer ----
export async function getActiveTimer(userId: string): Promise<ActiveTimer | undefined> {
  const rows = await db.select().from(activeTimers).where(eq(activeTimers.userId, userId)).limit(1);
  return rows[0];
}

export async function listActiveTimers(): Promise<ActiveTimer[]> {
  return db.select().from(activeTimers);
}

export async function startTimer(userId: string, input: StartTimerInput): Promise<ActiveTimer> {
  const existing = await getActiveTimer(userId);
  if (existing) {
    await stopTimer(userId);
  }
  // Infer projectId from the linked to-do when the caller didn't provide one
  // (e.g. UI now starts timers from project-less to-dos). If the to-do also
  // has no project, the timer simply runs with project_id = NULL.
  let projectId: string | null = input.projectId ?? null;
  if (!projectId && input.todoId) {
    const todo = await getTodo(input.todoId);
    projectId = todo?.projectId ?? null;
  }
  const startedAt = new Date().toISOString();
  const [row] = await db
    .insert(activeTimers)
    .values({
      userId,
      projectId,
      note: input.note,
      todoId: input.todoId ?? null,
      startedAt,
    })
    .returning();
  if (!row) throw new Error('timer insert failed');
  emit.toUserAndApprovers(userId, EV.TIMER_STARTED, {
    userId: row.userId,
    projectId: row.projectId,
    todoId: row.todoId,
    note: row.note,
    startedAt: row.startedAt,
  });
  await appendActivity({ whoId: userId, kind: 'time.start', target: input.note });
  return row;
}

export async function stopTimer(userId: string): Promise<TimeEntry | null> {
  const t = await getActiveTimer(userId);
  if (!t) return null;
  const endIso = new Date().toISOString();
  const durationMin = minutesBetween(t.startedAt, endIso);
  const period = await periodForDate(t.startedAt);
  const [entry] = await db
    .insert(timeEntries)
    .values({
      userId,
      projectId: t.projectId,
      note: t.note,
      startIso: t.startedAt,
      endIso,
      durationMin,
      payPeriodId: period?.id ?? null,
      status: 'draft',
      todoId: t.todoId ?? null,
    })
    .returning();
  await db.delete(activeTimers).where(eq(activeTimers.userId, userId));
  if (!entry) throw new Error('entry insert failed');
  if (t.todoId) await logTimeToTodo(t.todoId, durationMin);

  emit.toUserAndApprovers(userId, EV.TIMER_STOPPED, {
    userId,
    projectId: t.projectId,
    todoId: t.todoId ?? null,
    note: t.note,
    startedAt: t.startedAt,
    durationMin,
    entryId: entry.id,
  });
  emit.toUser(userId, EV.ENTRY_CREATED, { id: entry.id, by: userId, at: new Date().toISOString() });
  await appendActivity({
    whoId: userId,
    kind: 'time.stop',
    target: `${t.note} (${durationMin}m)`,
  });
  return entry;
}

// ---- Entries CRUD ----
export async function listEntries(
  viewerId: string,
  canViewAll: boolean,
  q: EntryListQuery,
): Promise<TimeEntry[]> {
  const conds = [];
  // Without time_entry.view_all, a user only sees their own entries.
  if (!canViewAll) {
    conds.push(eq(timeEntries.userId, viewerId));
  } else if (q.userId) {
    conds.push(eq(timeEntries.userId, q.userId));
  }
  if (q.periodId) conds.push(eq(timeEntries.payPeriodId, q.periodId));
  if (q.status) conds.push(eq(timeEntries.status, q.status));
  if (q.from) conds.push(gte(timeEntries.startIso, q.from + 'T00:00:00Z'));
  if (q.to) conds.push(lte(timeEntries.startIso, q.to + 'T23:59:59Z'));

  const where = conds.length > 0 ? and(...conds) : undefined;
  const query = db.select().from(timeEntries).orderBy(desc(timeEntries.startIso)).limit(q.limit);
  return where ? query.where(where) : query;
}

export async function createManualEntry(userId: string, input: ManualEntryInput): Promise<TimeEntry> {
  const period = await periodForDate(input.startIso);
  const durationMin = minutesBetween(input.startIso, input.endIso);
  // Same project-inference fallback as startTimer when caller omits projectId.
  let projectId: string | null = input.projectId ?? null;
  if (!projectId && input.todoId) {
    const todo = await getTodo(input.todoId);
    projectId = todo?.projectId ?? null;
  }
  const [row] = await db
    .insert(timeEntries)
    .values({
      userId,
      projectId,
      note: input.note,
      startIso: input.startIso,
      endIso: input.endIso,
      durationMin,
      payPeriodId: period?.id ?? null,
      status: 'draft',
      todoId: input.todoId ?? null,
    })
    .returning();
  if (!row) throw new Error('entry insert failed');
  if (input.todoId) await logTimeToTodo(input.todoId, durationMin);
  emit.toUser(userId, EV.ENTRY_CREATED, { id: row.id, by: userId, at: new Date().toISOString() });
  return row;
}

export async function updateEntry(
  id: string,
  viewerId: string,
  canManageAll: boolean,
  patch: Partial<ManualEntryInput>,
): Promise<TimeEntry> {
  const rows = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new HttpError(404, 'entry_not_found');
  const canEdit = row.userId === viewerId && row.status === 'draft';
  if (!canEdit && !canManageAll) throw new HttpError(403, 'forbidden');

  const upd: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.projectId !== undefined) upd.projectId = patch.projectId;
  if (patch.note !== undefined) upd.note = patch.note;
  const nextStart = patch.startIso ?? row.startIso;
  const nextEnd = patch.endIso ?? row.endIso ?? undefined;
  if (patch.startIso !== undefined) {
    upd.startIso = patch.startIso;
    const p = await periodForDate(patch.startIso);
    upd.payPeriodId = p?.id ?? null;
  }
  if (patch.endIso !== undefined) upd.endIso = patch.endIso;
  if ((patch.startIso !== undefined || patch.endIso !== undefined) && nextEnd) {
    upd.durationMin = minutesBetween(nextStart, nextEnd);
  }
  if (patch.todoId !== undefined) upd.todoId = patch.todoId;
  const [updated] = await db.update(timeEntries).set(upd).where(eq(timeEntries.id, id)).returning();
  if (!updated) throw new HttpError(404, 'entry_not_found');
  emit.toUser(updated.userId, EV.ENTRY_UPDATED, { id: updated.id, by: viewerId, at: new Date().toISOString() });
  return updated;
}

export async function deleteEntry(id: string, viewerId: string, canManageAll: boolean): Promise<void> {
  const rows = await db.select().from(timeEntries).where(eq(timeEntries.id, id)).limit(1);
  const row = rows[0];
  if (!row) throw new HttpError(404, 'entry_not_found');
  const canDel = row.userId === viewerId && row.status === 'draft';
  if (!canDel && !canManageAll) throw new HttpError(403, 'forbidden');
  await db.delete(timeEntries).where(eq(timeEntries.id, id));
  emit.toUser(row.userId, EV.ENTRY_DELETED, { id: row.id, by: viewerId, at: new Date().toISOString() });
}

// ---- Workflow ----
export async function submitEntries(ids: string[], whoId: string): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .update(timeEntries)
    .set({ status: 'submitted', submittedAt: now, rejectionNote: null, updatedAt: now })
    .where(
      and(
        inArray(timeEntries.id, ids),
        or(eq(timeEntries.status, 'draft'), eq(timeEntries.status, 'rejected')),
      ),
    )
    .returning({ id: timeEntries.id, userId: timeEntries.userId });
  const userIds = [...new Set(result.map((r) => r.userId))];
  for (const uid of userIds) {
    emit.toUserAndApprovers(uid, EV.ENTRY_SUBMITTED, {
      id: uid,
      by: whoId,
      at: now,
      count: result.filter((r) => r.userId === uid).length,
    });
  }
  if (result.length > 0) {
    await appendActivity({
      whoId,
      kind: 'time.submit',
      target: `${result.length} entries submitted for approval`,
    });
  }
  return result.length;
}

export async function approveEntries(ids: string[], whoId: string): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .update(timeEntries)
    .set({ status: 'approved', approvedBy: whoId, approvedAt: now, rejectionNote: null, updatedAt: now })
    .where(inArray(timeEntries.id, ids))
    .returning({ id: timeEntries.id, userId: timeEntries.userId });
  const userIds = [...new Set(result.map((r) => r.userId))];
  for (const uid of userIds) {
    emit.toUserAndApprovers(uid, EV.ENTRY_APPROVED, {
      id: uid,
      by: whoId,
      at: now,
      count: result.filter((r) => r.userId === uid).length,
    });
  }
  if (result.length > 0) {
    await appendActivity({
      whoId,
      kind: 'time.approve',
      target: `${result.length} entries approved`,
    });
  }
  return result.length;
}

export async function rejectEntries(ids: string[], note: string, whoId: string): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .update(timeEntries)
    .set({ status: 'rejected', rejectionNote: note, updatedAt: now })
    .where(inArray(timeEntries.id, ids))
    .returning({ id: timeEntries.id, userId: timeEntries.userId });
  const userIds = [...new Set(result.map((r) => r.userId))];
  for (const uid of userIds) {
    emit.toUserAndApprovers(uid, EV.ENTRY_REJECTED, {
      id: uid,
      by: whoId,
      at: now,
      count: result.filter((r) => r.userId === uid).length,
    });
  }
  if (result.length > 0) {
    await appendActivity({
      whoId,
      kind: 'time.reject',
      target: `${result.length} entries returned for review`,
    });
  }
  return result.length;
}

export async function reopenEntries(ids: string[], whoId: string): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .update(timeEntries)
    .set({ status: 'submitted', approvedBy: null, approvedAt: null, updatedAt: now })
    .where(inArray(timeEntries.id, ids))
    .returning({ id: timeEntries.id, userId: timeEntries.userId });
  const userIds = [...new Set(result.map((r) => r.userId))];
  for (const uid of userIds) {
    emit.toUserAndApprovers(uid, EV.ENTRY_REOPENED, {
      id: uid,
      by: whoId,
      at: now,
      count: result.filter((r) => r.userId === uid).length,
    });
  }
  return result.length;
}
