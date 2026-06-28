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
import { isMember } from '../services/tenants.js';
import { getUser } from '../services/users.js';
import { appendActivity } from '../services/activity.js';
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

/**
 * Can the caller create / submit time for OTHER workspace members? True for
 * full-edit admins (`time_entry.edit`) and for the narrower, dedicated
 * `time_entry.submit_on_behalf` role (log + submit a teammate's hours without
 * the reach to edit or delete arbitrary entries). Note this only governs the
 * on-behalf paths — editing/deleting other people's entries still requires
 * `time_entry.edit` / `time_entry.delete` respectively.
 */
async function canActForOthers(req: Parameters<typeof userCan>[0]): Promise<boolean> {
  return (
    (await userCan(req, 'time_entry.edit')) ||
    (await userCan(req, 'time_entry.submit_on_behalf'))
  );
}

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
    const input = getValidated<typeof ManualEntrySchema._type>(req);
    // On-behalf entry: admins with `time_entry.edit` OR the narrower
    // `time_entry.submit_on_behalf` can log time for any member of the ACTIVE
    // workspace (cross-tenant ids 404 via isMember). The entry lands as that
    // user's draft, exactly as if they logged it.
    let targetUserId = me.userId;
    if (input.userId && input.userId !== me.userId) {
      if (!(await canActForOthers(req))) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      if (!(await isMember(input.userId, me.tenantId))) {
        res.status(404).json({ error: 'user_not_found' });
        return;
      }
      targetUserId = input.userId;
    }
    const row = await createManualEntry(targetUserId, input);
    if (targetUserId !== me.userId) {
      const target = await getUser(targetUserId);
      await appendActivity({
        whoId: me.userId,
        kind: 'time.create_on_behalf',
        target: `Logged ${row.durationMin}m for ${target?.name ?? 'a teammate'}`,
      });
    }
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
    // `time_entry.edit` or `time_entry.submit_on_behalf` admins may submit on
    // behalf of teammates; everyone else is scoped to their own entries inside
    // submitEntries.
    const canManageAll = await canActForOthers(req);
    const count = await submitEntries(getValidated<typeof BulkIdsSchema._type>(req).ids, me.userId, canManageAll);
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
