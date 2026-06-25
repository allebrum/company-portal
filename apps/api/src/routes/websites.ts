import { Router } from 'express';
import { CreateWebsiteSchema, UpdateWebsiteSchema } from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { getValidated, validate } from '../middleware/validate.js';
import * as websitesSvc from '../services/websites.js';

export const websitesRouter = Router();

websitesRouter.use(requireAuth);

websitesRouter.get('/', async (req, res, next) => {
  try {
    res.json(await websitesSvc.listWebsites());
  } catch (e) {
    next(e);
  }
});

websitesRouter.post('/', validate(CreateWebsiteSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const input = getValidated<typeof CreateWebsiteSchema._type>(req);
    res.status(201).json(await websitesSvc.createWebsite({ actorId: me.userId, input }));
  } catch (e) {
    next(e);
  }
});

websitesRouter.patch('/:id', validate(UpdateWebsiteSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const patch = getValidated<typeof UpdateWebsiteSchema._type>(req);
    res.json(await websitesSvc.updateWebsite({ id: req.params.id!, actorId: me.userId, patch }));
  } catch (e) {
    next(e);
  }
});

websitesRouter.delete('/:id', async (req, res, next) => {
  try {
    const me = req.session.user!;
    await websitesSvc.archiveWebsite({ id: req.params.id!, actorId: me.userId });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

websitesRouter.get('/:id/credentials', async (req, res, next) => {
  try {
    const me = req.session.user!;
    res.json(await websitesSvc.readCredentials({ id: req.params.id!, viewerId: me.userId }));
  } catch (e) {
    next(e);
  }
});
