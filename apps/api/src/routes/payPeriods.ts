import { Router } from 'express';
import { GeneratePeriodsSchema } from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { requirePermission } from '../auth/permissions.js';
import { validate, getValidated } from '../middleware/validate.js';
import {
  listPeriods,
  generateAndInsert,
  moveToReview,
  closePeriod,
  reopenPeriod,
  ensureFuturePeriods,
  sendPayrollReportToBookkeeper,
} from '../services/payPeriods.js';

export const payPeriodsRouter = Router();

payPeriodsRouter.use(requireAuth);

payPeriodsRouter.get('/', async (req, res, next) => {
  try {
    // Lazy-fill: every list call ensures the workspace has a runway of
    // future open periods so admins never need to manually generate.
    // Idempotent; usually a no-op.
    const me = req.session.user;
    try {
      await ensureFuturePeriods({ whoId: me?.userId });
    } catch (e) {
      console.error('[pay-periods] ensureFuturePeriods failed', e);
    }
    res.json(await listPeriods());
  } catch (e) {
    next(e);
  }
});

payPeriodsRouter.post(
  '/generate',
  requirePermission('pay.manage'),
  validate(GeneratePeriodsSchema),
  async (req, res, next) => {
    try {
      const me = req.session.user!;
      const { count, fromDate } = getValidated<typeof GeneratePeriodsSchema._type>(req);
      const result = await generateAndInsert({ whoId: me.userId, count, fromDate });
      res.json(result);
    } catch (e) {
      next(e);
    }
  },
);

payPeriodsRouter.post('/:id/review', requirePermission('pay.manage'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    await moveToReview(req.params.id!, me.userId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

payPeriodsRouter.post('/:id/close', requirePermission('pay.manage'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const result = await closePeriod(req.params.id!, me.userId);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

payPeriodsRouter.post('/:id/reopen', requirePermission('pay.manage'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    await reopenPeriod(req.params.id!, me.userId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/**
 * Email a payroll summary of this period to the workspace's bookkeeper.
 * Sent from the clicking admin's connected Gmail (existing F4 plumbing).
 * Returns 400 if app_settings.bookkeeperEmail isn't set yet — the UI
 * surfaces that as a hint with a link to Pay settings.
 */
payPeriodsRouter.post('/:id/send-bookkeeper', requirePermission('pay.manage'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const result = await sendPayrollReportToBookkeeper(req.params.id!, me.userId);
    res.json(result);
  } catch (e) {
    next(e);
  }
});
