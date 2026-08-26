import { Router } from 'express';
import {
  InvoicingEntriesQuerySchema,
  MarkInvoicedSchema,
  UnmarkInvoicedSchema,
  CreateQboInvoiceSchema,
} from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { requirePermission } from '../auth/permissions.js';
import { validate, getValidated } from '../middleware/validate.js';
import {
  listInvoicingEntries,
  markEntriesInvoiced,
  unmarkEntriesInvoiced,
  createInvoiceFromEntries,
} from '../services/invoicing.js';

// Client invoicing — every route needs `invoices.manage`: the surface exposes
// billing state across the whole workspace and mutates it in bulk.
export const invoicingRouter = Router();

invoicingRouter.use(requireAuth);
invoicingRouter.use(requirePermission('invoices.manage'));

// Entries for a client's or project's invoicing tab (exactly one scope).
invoicingRouter.get(
  '/entries',
  validate(InvoicingEntriesQuerySchema, 'query'),
  async (req, res, next) => {
    try {
      const q = getValidated<typeof InvoicingEntriesQuerySchema._type>(req, 'query');
      if (!q.clientId === !q.projectId) {
        res.status(400).json({ error: 'client_or_project_required' });
        return;
      }
      res.json(await listInvoicingEntries(q));
    } catch (e) {
      next(e);
    }
  },
);

invoicingRouter.post('/mark', validate(MarkInvoicedSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const input = getValidated<typeof MarkInvoicedSchema._type>(req);
    const count = await markEntriesInvoiced(input.ids, me.userId, input.invoiceRef);
    res.json({ count });
  } catch (e) {
    next(e);
  }
});

invoicingRouter.post('/unmark', validate(UnmarkInvoicedSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const input = getValidated<typeof UnmarkInvoicedSchema._type>(req);
    const count = await unmarkEntriesInvoiced(input.ids, me.userId);
    res.json({ count });
  } catch (e) {
    next(e);
  }
});

// Create a QuickBooks invoice from selected entries, then mark them invoiced
// with the QuickBooks doc number as the reference.
invoicingRouter.post('/quickbooks/invoice', validate(CreateQboInvoiceSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const input = getValidated<typeof CreateQboInvoiceSchema._type>(req);
    res.status(201).json(await createInvoiceFromEntries(input, me.userId));
  } catch (e) {
    next(e);
  }
});
