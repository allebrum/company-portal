import { eq, and, desc, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  tickets,
  ticketMessages,
  todos,
  projects,
  clientContacts,
  users,
  type Ticket,
} from '../db/schema.js';
import type { CreateTicketInput, UpdateTicketInput, TicketRow, TicketMessageRow, TicketDetail, TicketStatus } from '@allebrum/shared';
import { EV } from '@allebrum/shared';
import { emit } from '../realtime/emit.js';
import { appendActivity } from './activity.js';
import { HttpError } from '../middleware/errorHandler.js';
import { tenantEq, stampTenant } from '../tenancy/scope.js';

/**
 * Sprint 4 — client ticketing. Every function here assumes it runs INSIDE a
 * tenant context (staff routes get one from the session middleware; portal
 * routes wrap calls in `withTenant(client.tenantId, …)` since portal requests
 * carry no staff session).
 *
 * Ticket ⇄ to-do contract: creating a ticket auto-creates an unassigned
 * triage to-do (tag `ticket`). The TICKET status is the source of truth — the
 * to-do mirrors it (resolved/closed ⇄ done). `syncTicketForTodoStatus` is the
 * reverse hook called from services/todos.ts; both directions no-op when
 * already in the target state, so the two writers can't ping-pong.
 */

const DONE_STATUSES: TicketStatus[] = ['resolved', 'closed'];

// ---- Row shaping --------------------------------------------------------

async function shapeRows(rows: Ticket[]): Promise<TicketRow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((t) => t.id);
  const contactIds = [...new Set(rows.map((t) => t.contactId).filter((v): v is string => !!v))];
  const [counts, contacts] = await Promise.all([
    db
      .select({ ticketId: ticketMessages.ticketId, n: sql<number>`count(*)::int` })
      .from(ticketMessages)
      .where(inArray(ticketMessages.ticketId, ids))
      .groupBy(ticketMessages.ticketId),
    contactIds.length
      ? db.select({ id: clientContacts.id, name: clientContacts.name }).from(clientContacts).where(inArray(clientContacts.id, contactIds))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  return rows.map((t) => ({
    id: t.id,
    clientId: t.clientId,
    projectId: t.projectId,
    contactId: t.contactId,
    todoId: t.todoId,
    title: t.title,
    status: t.status,
    priority: t.priority,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    resolvedAt: t.resolvedAt,
    messageCount: counts.find((c) => c.ticketId === t.id)?.n ?? 0,
    openedBy: contacts.find((c) => c.id === t.contactId)?.name ?? null,
  }));
}

async function shapeMessages(ticketId: string): Promise<TicketMessageRow[]> {
  const rows = await db
    .select()
    .from(ticketMessages)
    .where(eq(ticketMessages.ticketId, ticketId))
    .orderBy(ticketMessages.createdAt);
  const contactIds = [...new Set(rows.map((m) => m.authorContactId).filter((v): v is string => !!v))];
  const userIds = [...new Set(rows.map((m) => m.authorUserId).filter((v): v is string => !!v))];
  const [contacts, staff] = await Promise.all([
    contactIds.length
      ? db.select({ id: clientContacts.id, name: clientContacts.name }).from(clientContacts).where(inArray(clientContacts.id, contactIds))
      : Promise.resolve([] as { id: string; name: string }[]),
    userIds.length
      ? db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  return rows.map((m) => ({
    id: m.id,
    ticketId: m.ticketId,
    authorKind: m.authorKind,
    authorName:
      m.authorKind === 'contact'
        ? (contacts.find((c) => c.id === m.authorContactId)?.name ?? null)
        : (staff.find((u) => u.id === m.authorUserId)?.name ?? null),
    body: m.body,
    createdAt: m.createdAt,
  }));
}

// ---- Reads --------------------------------------------------------------

export async function listTickets(filter: { clientId?: string; status?: TicketStatus; todoId?: string }): Promise<TicketRow[]> {
  const conds = [tenantEq(tickets.tenantId)];
  if (filter.clientId) conds.push(eq(tickets.clientId, filter.clientId));
  if (filter.status) conds.push(eq(tickets.status, filter.status));
  if (filter.todoId) conds.push(eq(tickets.todoId, filter.todoId));
  const rows = await db
    .select()
    .from(tickets)
    .where(and(...conds))
    .orderBy(desc(tickets.updatedAt));
  return shapeRows(rows);
}

/** `clientId` scopes the lookup for portal callers — the session's clientId is
 *  the only authority there. Staff callers pass none (tenant scope only). */
export async function getTicketDetail(id: string, opts: { clientId?: string } = {}): Promise<TicketDetail | undefined> {
  const conds = [eq(tickets.id, id), tenantEq(tickets.tenantId)];
  if (opts.clientId) conds.push(eq(tickets.clientId, opts.clientId));
  const rows = await db.select().from(tickets).where(and(...conds)).limit(1);
  const t = rows[0];
  if (!t) return undefined;
  const [shaped] = await shapeRows([t]);
  return { ...shaped!, body: t.body, messages: await shapeMessages(t.id) };
}

// ---- Create (portal) ----------------------------------------------------

export async function createTicketFromPortal(input: CreateTicketInput & {
  clientId: string;
  contactId: string;
  contactName: string;
}): Promise<TicketDetail> {
  // projectId must be one of THIS client's projects — cross-client probes 404.
  if (input.projectId) {
    const [p] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.clientId, input.clientId)))
      .limit(1);
    if (!p) throw new HttpError(404, 'project_not_found');
  }

  // The linked triage to-do. Inserted directly (NOT via createTodo) because
  // the author is a contact, not a user — createTodo would default the
  // assignee to whoId, and contact ids are not valid users FKs.
  const [todo] = await db
    .insert(todos)
    .values(stampTenant({
      title: `Ticket: ${input.title}`,
      description: `${input.body}\n\nFrom client ticket by ${input.contactName} — open: /clients?space=client:${input.clientId}&spaceTab=tickets`,
      assigneeId: null,
      clientId: input.clientId,
      projectId: input.projectId ?? null,
      tags: ['ticket'],
      private: false,
    }))
    .returning();
  if (!todo) throw new Error('ticket todo insert failed');

  const [ticket] = await db
    .insert(tickets)
    .values(stampTenant({
      clientId: input.clientId,
      projectId: input.projectId ?? null,
      contactId: input.contactId,
      title: input.title,
      body: input.body,
      todoId: todo.id,
    }))
    .returning();
  if (!ticket) throw new Error('ticket insert failed');

  const now = new Date().toISOString();
  emit.toOrg(EV.TODO_CREATED, { id: todo.id, by: null, at: now });
  emit.toOrg(EV.TICKET_CREATED, { id: ticket.id, by: null, at: now });
  await appendActivity({
    whoId: null,
    kind: 'ticket.create',
    target: `${input.contactName} opened ticket “${ticket.title}”`,
  });

  const [shaped] = await shapeRows([ticket]);
  return { ...shaped!, body: ticket.body, messages: [] };
}

// ---- Thread -------------------------------------------------------------

export async function addTicketMessage(input: {
  ticketId: string;
  body: string;
  author: { kind: 'contact'; contactId: string; name: string } | { kind: 'staff'; userId: string };
  /** Portal callers pass the session clientId so they can't post into
   *  another client's thread. */
  clientId?: string;
}): Promise<TicketMessageRow> {
  const conds = [eq(tickets.id, input.ticketId), tenantEq(tickets.tenantId)];
  if (input.clientId) conds.push(eq(tickets.clientId, input.clientId));
  const [ticket] = await db.select().from(tickets).where(and(...conds)).limit(1);
  if (!ticket) throw new HttpError(404, 'ticket_not_found');
  if (ticket.status === 'closed') throw new HttpError(409, 'ticket_closed');

  const [row] = await db
    .insert(ticketMessages)
    .values(stampTenant({
      ticketId: ticket.id,
      authorKind: input.author.kind,
      authorContactId: input.author.kind === 'contact' ? input.author.contactId : null,
      authorUserId: input.author.kind === 'staff' ? input.author.userId : null,
      body: input.body,
    }))
    .returning();
  if (!row) throw new Error('ticket message insert failed');

  // A client replying to a resolved ticket reopens it (and its to-do) —
  // "resolved" is staff's claim; the client gets to dispute it. Staff
  // replies never change status implicitly.
  let reopened = false;
  if (input.author.kind === 'contact' && ticket.status === 'resolved') {
    await applyTicketStatus(ticket, 'open', null);
    reopened = true;
  } else {
    await db.update(tickets).set({ updatedAt: row.createdAt }).where(eq(tickets.id, ticket.id));
  }

  emit.toOrg(EV.TICKET_MESSAGE, { id: ticket.id, by: input.author.kind === 'staff' ? input.author.userId : null, at: row.createdAt });
  if (input.author.kind === 'contact') {
    await appendActivity({
      whoId: null,
      kind: 'ticket.message',
      target: `${input.author.name} replied on ticket “${ticket.title}”${reopened ? ' (reopened)' : ''}`,
    });
  }

  const [shaped] = await shapeMessages(ticket.id).then((ms) => ms.filter((m) => m.id === row.id));
  return shaped!;
}

// ---- Status / staff patch ------------------------------------------------

/** Writes a status change + resolvedAt bookkeeping + mirrors the linked
 *  to-do. No-ops when already in the target status. */
async function applyTicketStatus(ticket: Ticket, status: TicketStatus, byUserId: string | null): Promise<void> {
  if (ticket.status === status) return;
  const now = new Date().toISOString();
  await db
    .update(tickets)
    .set({
      status,
      updatedAt: now,
      resolvedAt: DONE_STATUSES.includes(status) ? (ticket.resolvedAt ?? now) : null,
    })
    .where(eq(tickets.id, ticket.id));

  // Mirror the linked to-do. Guarded by current value so the reverse hook
  // (syncTicketForTodoStatus) sees a no-op when it fires back.
  if (ticket.todoId) {
    const wantDone = DONE_STATUSES.includes(status);
    const [todo] = await db.select().from(todos).where(eq(todos.id, ticket.todoId)).limit(1);
    if (todo && (todo.status === 'done') !== wantDone) {
      await db
        .update(todos)
        .set({ status: wantDone ? 'done' : 'open', updatedAt: now })
        .where(eq(todos.id, todo.id));
      emit.toOrg(EV.TODO_UPDATED, { id: todo.id, by: byUserId, at: now });
    }
  }
  emit.toOrg(EV.TICKET_UPDATED, { id: ticket.id, by: byUserId, at: now });
}

export async function updateTicket(id: string, patch: UpdateTicketInput, whoUserId: string): Promise<TicketRow> {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, id), tenantEq(tickets.tenantId)))
    .limit(1);
  if (!ticket) throw new HttpError(404, 'ticket_not_found');

  if (patch.projectId !== undefined && patch.projectId !== null) {
    const [p] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, patch.projectId), eq(projects.clientId, ticket.clientId)))
      .limit(1);
    if (!p) throw new HttpError(404, 'project_not_found');
  }

  const upd: Record<string, unknown> = {};
  if (patch.priority !== undefined) upd.priority = patch.priority;
  if (patch.projectId !== undefined) upd.projectId = patch.projectId;
  if (Object.keys(upd).length > 0) {
    upd.updatedAt = new Date().toISOString();
    await db.update(tickets).set(upd).where(eq(tickets.id, ticket.id));
  }

  if (patch.status !== undefined && patch.status !== ticket.status) {
    await applyTicketStatus(ticket, patch.status, whoUserId);
    await appendActivity({
      whoId: whoUserId,
      kind: 'ticket.status',
      target: `Ticket “${ticket.title}” → ${patch.status.replace(/_/g, ' ')}`,
    });
  } else if (Object.keys(upd).length > 0) {
    emit.toOrg(EV.TICKET_UPDATED, { id: ticket.id, by: whoUserId, at: String(upd.updatedAt) });
  }

  const [fresh] = await db.select().from(tickets).where(eq(tickets.id, ticket.id)).limit(1);
  const [shaped] = await shapeRows([fresh!]);
  return shaped!;
}

// ---- Reverse hook (todos service) ----------------------------------------

/** Called from services/todos.ts whenever a todo's status changes. Completing
 *  the to-do resolves its ticket; reopening the to-do pulls a RESOLVED ticket
 *  back to in_progress (a CLOSED ticket stays closed — that's staff's
 *  explicit terminal call, the to-do is just a work item). */
export async function syncTicketForTodoStatus(todoId: string, todoStatus: string, whoUserId: string): Promise<void> {
  const [ticket] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.todoId, todoId), tenantEq(tickets.tenantId)))
    .limit(1);
  if (!ticket) return;
  if (todoStatus === 'done' && !DONE_STATUSES.includes(ticket.status)) {
    await applyTicketStatus(ticket, 'resolved', whoUserId);
    await appendActivity({ whoId: whoUserId, kind: 'ticket.status', target: `Ticket “${ticket.title}” → resolved` });
  } else if (todoStatus === 'open' && ticket.status === 'resolved') {
    await applyTicketStatus(ticket, 'in_progress', whoUserId);
  }
}
