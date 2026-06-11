import { z } from 'zod';
import { TICKET_STATUSES, PRIORITIES, type TicketStatus, type TicketAuthorKind, type Priority } from '../enums';

/**
 * Sprint 4 — client ticketing. Clients open tickets from the portal; each
 * ticket auto-creates a linked team to-do (tickets.todoId). The ticket status
 * is the source of truth; the to-do follows (resolve ⇄ done).
 */

/** Portal: a contact opens a ticket. projectId must be one of the contact's
 *  client's projects (validated server-side against the session's clientId). */
export const CreateTicketSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  projectId: z.string().uuid().optional(),
});
export type CreateTicketInput = z.infer<typeof CreateTicketSchema>;

/** Portal + staff: append a message to the thread. */
export const TicketMessageSchema = z.object({
  body: z.string().min(1).max(5000),
});
export type TicketMessageInput = z.infer<typeof TicketMessageSchema>;

/** Staff: patch status / priority / project. */
export const UpdateTicketSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  projectId: z.string().uuid().nullable().optional(),
});
export type UpdateTicketInput = z.infer<typeof UpdateTicketSchema>;

/** Shared row shape for both surfaces (portal omits nothing today — tickets
 *  are client-authored, so there are no internal-only fields). */
export type TicketRow = {
  id: string;
  clientId: string;
  projectId: string | null;
  contactId: string | null;
  todoId: string | null;
  title: string;
  status: TicketStatus;
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  /** Convenience for list views. */
  messageCount: number;
  /** Display name of the opening contact (null when the contact was deleted). */
  openedBy: string | null;
};

export type TicketMessageRow = {
  id: string;
  ticketId: string;
  authorKind: TicketAuthorKind;
  /** Resolved display name of the author (contact or staff user). */
  authorName: string | null;
  body: string;
  createdAt: string;
};

export type TicketDetail = TicketRow & {
  body: string;
  messages: TicketMessageRow[];
};
