import { Router } from 'express';
import { CreateClientSchema, UpdateClientSchema } from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { requirePermission } from '../auth/permissions.js';
import { validate, getValidated } from '../middleware/validate.js';
import { listClients, createClient, updateClient } from '../services/clients.js';

export const clientsRouter = Router();

clientsRouter.use(requireAuth);

clientsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await listClients());
  } catch (e) {
    next(e);
  }
});

clientsRouter.post('/', requirePermission('clients.manage'), validate(CreateClientSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await createClient(getValidated<typeof CreateClientSchema._type>(req), me.userId);
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

clientsRouter.patch('/:id', requirePermission('clients.manage'), validate(UpdateClientSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await updateClient(req.params.id!, getValidated<typeof UpdateClientSchema._type>(req), me.userId);
    res.json(row);
  } catch (e) {
    next(e);
  }
});
