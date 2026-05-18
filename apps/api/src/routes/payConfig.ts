import { Router } from 'express';
import { PayConfigSchema } from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { requirePermission } from '../auth/permissions.js';
import { validate, getValidated } from '../middleware/validate.js';
import { getConfig, updateConfig } from '../services/payConfig.js';

export const payConfigRouter = Router();

payConfigRouter.use(requireAuth);

payConfigRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await getConfig());
  } catch (e) {
    next(e);
  }
});

payConfigRouter.patch('/', requirePermission('pay.manage'), validate(PayConfigSchema.partial()), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await updateConfig(getValidated<Partial<typeof PayConfigSchema._type>>(req), me.userId);
    res.json(row);
  } catch (e) {
    next(e);
  }
});
