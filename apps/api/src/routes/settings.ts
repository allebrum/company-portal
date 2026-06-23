import { Router } from 'express';
import { UpdateAppSettingsSchema } from '@modernzen/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { requirePermission } from '../auth/permissions.js';
import { validate, getValidated } from '../middleware/validate.js';
import { getSettings, updateSettings } from '../services/settings.js';

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

settingsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await getSettings());
  } catch (e) {
    next(e);
  }
});

settingsRouter.patch(
  '/',
  requirePermission('groups.manage'),
  validate(UpdateAppSettingsSchema),
  async (req, res, next) => {
    try {
      const me = req.session.user!;
      const row = await updateSettings(getValidated<typeof UpdateAppSettingsSchema._type>(req), me.userId);
      res.json(row);
    } catch (e) {
      next(e);
    }
  },
);
