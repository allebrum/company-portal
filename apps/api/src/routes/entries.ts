import { Router } from 'express';
import {
  StartTimerSchema,
  ManualEntrySchema,
  UpdateManualEntrySchema,
  BulkIdsSchema,
  RejectEntriesSchema,
  EntryListQuerySchema,
} from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { requirePermission, userCan } from '../auth/permissions.js';
import { validate, getValidated } from '../middleware/validate.js';
import {
  listEntries,
  createManualEntry,
  updateEntry,
  deleteEntry,
  startTimer,
  stopTimer,
  submitEntries,
  approveEntries,
  rejectEntries,
  reopenEntries,
  getActiveTimer,
  listActiveTimers,
  exportEntriesCsv,
} from '../services/entries.js';

export const entriesRouter = Router();

entriesRouter.use(requireAuth);

entriesRouter.get('/', validate(EntryListQuerySchema, 'query'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const q = getValidated<typeof EntryListQuerySchema._type>(req, 'query');
    const canViewAll = await userCan(req, 'time_entry.view_all');
    res.json(await listEntries(me.userId, canViewAll, q));
  } catch (e) {
    next(e);
  }
});

// CSV export — gated by pay.manage (Bookkeeper / Admin / Owner). Reuses the
// EntryListQuerySchema so the same `periodId`, `from`, `to`, `status`,
// `userId` filters work for both list and export. The browser handles the
// download (cookies pass automatically since we redirect via the same origin).
entriesRouter.get('/export.csv', requirePermission('pay.manage'), validate(EntryListQuerySchema, 'query'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const q = getValidated<typeof EntryListQuerySchema._type>(req, 'query');
    const { filename, csv } = await exportEntriesCsv(me.userId, q);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    // BOM so Excel auto-detects UTF-8 instead of mojibake on non-ASCII names.
    res.send('﻿' + csv);
  } catch (e) {
    next(e);
  }
});

entriesRouter.get('/timer', async (req, res, next) => {
  try {
    const me = req.session.user!;
    res.json((await getActiveTimer(me.userId)) ?? null);
  } catch (e) {
    next(e);
  }
});

entriesRouter.get('/timers', async (_req, res, next) => {
  try {
    res.json(await listActiveTimers());
  } catch (e) {
    next(e);
  }
});

entriesRouter.post('/timer/start', validate(StartTimerSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await startTimer(me.userId, getValidated<typeof StartTimerSchema._type>(req));
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

entriesRouter.post('/timer/stop', async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await stopTimer(me.userId);
    if (!row) {
      res.status(404).json({ error: 'no_active_timer' });
      return;
    }
    res.json(row);
  } catch (e) {
    next(e);
  }
});

entriesRouter.post('/', validate(ManualEntrySchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await createManualEntry(me.userId, getValidated<typeof ManualEntrySchema._type>(req));
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

entriesRouter.patch('/:id', validate(UpdateManualEntrySchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const canManageAll = await userCan(req, 'time_entry.edit');
    const row = await updateEntry(req.params.id!, me.userId, canManageAll, req.body);
    res.json(row);
  } catch (e) {
    next(e);
  }
});

entriesRouter.delete('/:id', async (req, res, next) => {
  try {
    const me = req.session.user!;
    const canManageAll = await userCan(req, 'time_entry.delete');
    await deleteEntry(req.params.id!, me.userId, canManageAll);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

entriesRouter.post('/submit', validate(BulkIdsSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const count = await submitEntries(getValidated<typeof BulkIdsSchema._type>(req).ids, me.userId);
    res.json({ count });
  } catch (e) {
    next(e);
  }
});

entriesRouter.post('/approve', requirePermission('time_entry.approve'), validate(BulkIdsSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const count = await approveEntries(getValidated<typeof BulkIdsSchema._type>(req).ids, me.userId);
    res.json({ count });
  } catch (e) {
    next(e);
  }
});

entriesRouter.post('/reject', requirePermission('time_entry.approve'), validate(RejectEntriesSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const body = getValidated<typeof RejectEntriesSchema._type>(req);
    const count = await rejectEntries(body.ids, body.note, me.userId);
    res.json({ count });
  } catch (e) {
    next(e);
  }
});

entriesRouter.post('/reopen', requirePermission('time_entry.approve'), validate(BulkIdsSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const count = await reopenEntries(getValidated<typeof BulkIdsSchema._type>(req).ids, me.userId);
    res.json({ count });
  } catch (e) {
    next(e);
  }
});
