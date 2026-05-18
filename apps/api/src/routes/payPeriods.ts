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
} from '../services/payPeriods.js';

export const payPeriodsRouter = Router();

payPeriodsRouter.use(requireAuth);

payPeriodsRouter.get('/', async (_req, res, next) => {
  try {
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
