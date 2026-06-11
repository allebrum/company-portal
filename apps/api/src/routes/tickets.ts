import { Router } from 'express';
import { UpdateTicketSchema, TicketMessageSchema, TICKET_STATUSES, type TicketStatus } from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { requirePermission } from '../auth/permissions.js';
import { validate, getValidated } from '../middleware/validate.js';
import {
  listTickets,
  getTicketDetail,
  updateTicket,
  addTicketMessage,
} from '../services/tickets.js';

/**
 * Sprint 4 — staff side of client ticketing. Reads + replies are open to any
 * authed staff member (tickets are client-facing comms, not a permissions
 * surface); status/priority/project changes are gated on the pre-existing
 * `tickets.manage` catalog entry (seeded since F23 in anticipation of this).
 */
export const ticketsRouter = Router();

ticketsRouter.use(requireAuth);

ticketsRouter.get('/', async (req, res, next) => {
  try {
    const clientId = typeof req.query.clientId === 'string' && req.query.clientId ? req.query.clientId : undefined;
    const todoId = typeof req.query.todoId === 'string' && req.query.todoId ? req.query.todoId : undefined;
    const rawStatus = typeof req.query.status === 'string' ? req.query.status : undefined;
    const status = (TICKET_STATUSES as readonly string[]).includes(rawStatus ?? '')
      ? (rawStatus as TicketStatus)
      : undefined;
    res.json(await listTickets({ clientId, status, todoId }));
  } catch (e) {
    next(e);
  }
});

ticketsRouter.get('/:id', async (req, res, next) => {
  try {
    const detail = await getTicketDetail(req.params.id!);
    if (!detail) {
      res.status(404).json({ error: 'ticket_not_found' });
      return;
    }
    res.json(detail);
  } catch (e) {
    next(e);
  }
});

ticketsRouter.patch('/:id', requirePermission('tickets.manage'), validate(UpdateTicketSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    res.json(await updateTicket(req.params.id!, getValidated<typeof UpdateTicketSchema._type>(req), me.userId));
  } catch (e) {
    next(e);
  }
});

ticketsRouter.post('/:id/messages', validate(TicketMessageSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const { body } = getValidated<typeof TicketMessageSchema._type>(req);
    const message = await addTicketMessage({
      ticketId: req.params.id!,
      body,
      author: { kind: 'staff', userId: me.userId },
    });
    res.status(201).json(message);
  } catch (e) {
    next(e);
  }
});
