import { eq, and, or, gte, lte, inArray, desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  timeEntries,
  activeTimers,
  todos,
  payPeriods,
  type TimeEntry,
  type ActiveTimer,
} from '../db/schema.js';
import { listUsers } from './users.js';
import { listProjects } from './projects.js';
import { listClients } from './clients.js';
import { listPeriods } from './payPeriods.js';
import type {
  StartTimerInput,
  ManualEntryInput,
  EntryListQuery,
} from '@modernzen/shared';
import { EV } from '@modernzen/shared';
import { emit } from '../realtime/emit.js';
import { appendActivity } from './activity.js';
import { getTodo, logTimeToTodo } from './todos.js';
import { periodForDate, ensureFuturePeriods } from './payPeriods.js';
import { HttpError } from '../middleware/errorHandler.js';
import { tenantEq, stampTenant } from '../tenancy/scope.js';

function minutesBetween(startIso: string, endIso: string): number {
  return Math.max(1, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
}

/**
 * Resolve the pay period covering `iso`, self-healing when the runway has
 * run dry: if no period matches, top up the schedule (idempotent, cheap)
 * and retry once. This is what guarantees entries always land in a period
 * even for workspaces where nobody has opened the Approvals page in months
 * — the lazy fill there was previously the only automatic generation.
 */
async function periodForDateEnsured(iso: string, whoId?: string) {
  const found = await periodForDate(iso);
  if (found) return found;
  try {
    await ensureFuturePeriods({ whoId });
  } catch (e) {
    console.error('[entries] ensureFuturePeriods failed during self-heal', e);
  }
  return periodForDate(iso);
}

// ---- Timer ----
export async function getActiveTimer(userId: string): Promise<ActiveTimer | undefined> {
  const rows = await db
    .select()
    .from(activeTimers)
    .where(and(eq(activeTimers.userId, userId), tenantEq(activeTimers.tenantId)))
    .limit(1);
  return rows[0];
}

export async function listActiveTimers(): Promise<ActiveTimer[]> {
  return db.select().from(activeTimers).where(tenantEq(activeTimers.tenantId));
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
    .values(stampTenant({
      userId,
      projectId,
      note: input.note,
      todoId: input.todoId ?? null,
      spaceBlockId: input.spaceBlockId ?? null,
      startedAt,
    }))
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
  const period = await periodForDateEnsured(t.startedAt, userId);
  const [entry] = await db
    .insert(timeEntries)
    .values(stampTenant({
      userId,
      projectId: t.projectId,
      note: t.note,
      startIso: t.startedAt,
      endIso,
      durationMin,
      payPeriodId: period?.id ?? null,
      status: 'draft',
      todoId: t.todoId ?? null,
      spaceBlockId: t.spaceBlockId ?? null,
    }))
    .returning();
  await db
    .delete(activeTimers)
    .where(and(eq(activeTimers.userId, userId), tenantEq(activeTimers.tenantId)));
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
  const conds = [tenantEq(timeEntries.tenantId)];
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

  const where = and(...conds);
  const query = db.select().from(timeEntries).orderBy(desc(timeEntries.startIso)).limit(q.limit);
  return query.where(where);
}

export async function createManualEntry(userId: string, input: ManualEntryInput): Promise<TimeEntry> {
  const period = await periodForDateEnsured(input.startIso, userId);
  const durationMin = minutesBetween(input.startIso, input.endIso);
  // Same project-inference fallback as startTimer when caller omits projectId.
  let projectId: string | null = input.projectId ?? null;
  if (!projectId && input.todoId) {
    const todo = await getTodo(input.todoId);
    projectId = todo?.projectId ?? null;
  }
  const [row] = await db
    .insert(timeEntries)
    .values(stampTenant({
      userId,
      projectId,
      note: input.note,
      startIso: input.startIso,
      endIso: input.endIso,
      durationMin,
      payPeriodId: period?.id ?? null,
      status: 'draft',
      todoId: input.todoId ?? null,
    }))
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
  const rows = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.id, id), tenantEq(timeEntries.tenantId)))
    .limit(1);
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
  const [updated] = await db
    .update(timeEntries)
    .set(upd)
    .where(and(eq(timeEntries.id, id), tenantEq(timeEntries.tenantId)))
    .returning();
  if (!updated) throw new HttpError(404, 'entry_not_found');
  emit.toUser(updated.userId, EV.ENTRY_UPDATED, { id: updated.id, by: viewerId, at: new Date().toISOString() });
  return updated;
}

export async function deleteEntry(id: string, viewerId: string, canManageAll: boolean): Promise<void> {
  const rows = await db
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.id, id), tenantEq(timeEntries.tenantId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new HttpError(404, 'entry_not_found');

  // Ownership / permission gate. The status check that previously
  // restricted self-delete to drafts is gone — users can delete any of
  // their own entries (draft, submitted, rejected, approved) so they
  // can correct mistakes without waiting on an admin. Admins with
  // `time_entry.delete` can still purge anyone's entries.
  const isOwner = row.userId === viewerId;
  if (!isOwner && !canManageAll) throw new HttpError(403, 'forbidden');

  // Closed-period guard. The period has been sealed (admin clicked
  // "Close period" — payroll math + bookkeeper email + paid totals
  // are now historical record). Deleting an entry inside it would
  // retroactively change the closed period's totals, which is a data-
  // integrity violation we won't paper over. An admin who really needs
  // to remove such an entry must reopen the period first.
  if (row.payPeriodId) {
    const periodRows = await db
      .select({ status: payPeriods.status })
      .from(payPeriods)
      .where(and(eq(payPeriods.id, row.payPeriodId), tenantEq(payPeriods.tenantId)))
      .limit(1);
    if (periodRows[0]?.status === 'closed') {
      throw new HttpError(409, 'entry_in_closed_period');
    }
  }

  await db.delete(timeEntries).where(and(eq(timeEntries.id, id), tenantEq(timeEntries.tenantId)));
  emit.toUser(row.userId, EV.ENTRY_DELETED, { id: row.id, by: viewerId, at: new Date().toISOString() });
  // Audit non-draft deletes so the activity feed shows that a user
  // withdrew an already-submitted/approved entry. Draft deletes happen
  // routinely while logging — too noisy to log.
  if (row.status !== 'draft') {
    await appendActivity({
      whoId: viewerId,
      kind: 'time.delete',
      target: `Deleted ${row.status} entry · ${row.durationMin}m`,
    });
  }
}

// ---- Workflow ----
/**
 * Submit draft/rejected entries for approval. Without `canManageAll`
 * (`time_entry.edit`), the update is scoped to the caller's OWN entries —
 * previously any authenticated user could force ANY teammate's drafts into
 * the approval queue by guessing ids. Admins keep the unscoped form so they
 * can submit time on behalf of their team.
 */
export async function submitEntries(ids: string[], whoId: string, canManageAll = false): Promise<number> {
  const now = new Date().toISOString();
  const conds = [
    inArray(timeEntries.id, ids),
    or(eq(timeEntries.status, 'draft'), eq(timeEntries.status, 'rejected')),
    tenantEq(timeEntries.tenantId),
  ];
  if (!canManageAll) conds.push(eq(timeEntries.userId, whoId));
  const result = await db
    .update(timeEntries)
    .set({ status: 'submitted', submittedAt: now, rejectionNote: null, updatedAt: now })
    .where(and(...conds))
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
    .where(and(inArray(timeEntries.id, ids), tenantEq(timeEntries.tenantId)))
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
    .where(and(inArray(timeEntries.id, ids), tenantEq(timeEntries.tenantId)))
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

// ---- CSV export ----
//
// Renders an Excel-safe CSV of every entry matching the EntryListQuery.
// `pay.manage` gate at the route — so viewerId is treated as canViewAll=true.
// The CSV uses CRLF line endings and prefixes any cell beginning with `=`,
// `+`, `-`, `@`, TAB or CR with a single quote to defuse the classic CSV
// formula-injection vector (user-named clients/projects can flow in here).
export async function exportEntriesCsv(
  viewerId: string,
  q: EntryListQuery,
): Promise<{ filename: string; csv: string }> {
  // Force a generous limit — for the export we want every matching row in
  // the period/range, not the paged 500 listEntries returns by default.
  const entries = await listEntries(viewerId, true, { ...q, limit: 2000 });
  const [usersArr, projectsArr, clientsArr, periodsArr] = await Promise.all([
    listUsers(),
    listProjects(),
    listClients(),
    listPeriods(),
  ]);
  const todoIds = [...new Set(entries.map((e) => e.todoId).filter((x): x is string => !!x))];
  const todosArr = todoIds.length
    ? await db.select().from(todos).where(and(inArray(todos.id, todoIds), tenantEq(todos.tenantId)))
    : [];

  const userById = new Map(usersArr.map((u) => [u.id, u]));
  const projectById = new Map(projectsArr.map((p) => [p.id, p]));
  const clientById = new Map(clientsArr.map((c) => [c.id, c]));
  const todoById = new Map(todosArr.map((t) => [t.id, t]));
  const periodById = new Map(periodsArr.map((p) => [p.id, p]));

  const header = [
    'date', 'user_name', 'user_email', 'client', 'project', 'todo',
    'note', 'start_iso', 'end_iso', 'duration_min', 'hours',
    'billable_rate', 'status', 'pay_period',
  ];

  const rows: string[][] = entries.map((e) => {
    const u = userById.get(e.userId);
    const p = e.projectId ? projectById.get(e.projectId) : undefined;
    const c = p ? clientById.get(p.clientId) : undefined;
    const t = e.todoId ? todoById.get(e.todoId) : undefined;
    const period = e.payPeriodId ? periodById.get(e.payPeriodId) : undefined;
    return [
      (e.startIso ?? '').slice(0, 10),
      u?.name ?? '',
      u?.email ?? '',
      c?.name ?? '',
      p?.name ?? '',
      t?.title ?? '',
      e.note ?? '',
      e.startIso ?? '',
      e.endIso ?? '',
      String(e.durationMin),
      (e.durationMin / 60).toFixed(2),
      u ? String(u.billable) : '',
      e.status,
      period?.label ?? '',
    ];
  });

  const escape = (raw: unknown): string => {
    let v = raw == null ? '' : String(raw);
    // Formula-injection guard (CSV → Excel auto-execute risk).
    if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
    return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };

  const lines = [
    header.map(escape).join(','),
    ...rows.map((r) => r.map(escape).join(',')),
  ];
  // CRLF + trailing newline keeps Excel happy across platforms.
  const csv = lines.join('\r\n') + '\r\n';

  let label = 'time-entries';
  if (q.periodId) {
    const p = periodById.get(q.periodId);
    if (p) label = `time-entries-${p.label.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}`;
  } else if (q.from || q.to) {
    label = `time-entries-${q.from ?? 'start'}-to-${q.to ?? 'now'}`;
  }
  return { filename: `${label}.csv`, csv };
}

export async function reopenEntries(ids: string[], whoId: string): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .update(timeEntries)
    .set({ status: 'submitted', approvedBy: null, approvedAt: null, updatedAt: now })
    .where(and(inArray(timeEntries.id, ids), tenantEq(timeEntries.tenantId)))
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
