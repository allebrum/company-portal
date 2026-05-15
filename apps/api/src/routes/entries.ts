import { Router } from 'express';
import {
  StartTimerSchema,
  ManualEntrySchema,
  BulkIdsSchema,
  RejectEntriesSchema,
  EntryListQuerySchema,
} from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
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
} from '../services/entries.js';

export const entriesRouter = Router();

entriesRouter.use(requireAuth);

entriesRouter.get('/', validate(EntryListQuerySchema, 'query'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const q = getValidated<typeof EntryListQuerySchema._type>(req, 'query');
    res.json(await listEntries(me.userId, me.role, q));
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

entriesRouter.patch('/:id', validate(ManualEntrySchema.partial()), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await updateEntry(req.params.id!, me.userId, me.role, req.body);
    res.json(row);
  } catch (e) {
    next(e);
  }
});

entriesRouter.delete('/:id', async (req, res, next) => {
  try {
    const me = req.session.user!;
    await deleteEntry(req.params.id!, me.userId, me.role);
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

entriesRouter.post('/approve', requireRole('owner', 'admin'), validate(BulkIdsSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const count = await approveEntries(getValidated<typeof BulkIdsSchema._type>(req).ids, me.userId);
    res.json({ count });
  } catch (e) {
    next(e);
  }
});

entriesRouter.post('/reject', requireRole('owner', 'admin'), validate(RejectEntriesSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const body = getValidated<typeof RejectEntriesSchema._type>(req);
    const count = await rejectEntries(body.ids, body.note, me.userId);
    res.json({ count });
  } catch (e) {
    next(e);
  }
});

entriesRouter.post('/reopen', requireRole('owner', 'admin'), validate(BulkIdsSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const count = await reopenEntries(getValidated<typeof BulkIdsSchema._type>(req).ids, me.userId);
    res.json({ count });
  } catch (e) {
    next(e);
  }
});
