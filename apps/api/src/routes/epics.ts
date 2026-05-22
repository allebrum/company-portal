import { Router } from 'express';
import { CreateEpicSchema, UpdateEpicSchema } from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate, getValidated } from '../middleware/validate.js';
import { listEpics, createEpic, updateEpic, deleteEpic } from '../services/epics.js';

export const epicsRouter = Router();
epicsRouter.use(requireAuth);

epicsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await listEpics());
  } catch (e) {
    next(e);
  }
});

epicsRouter.post('/', validate(CreateEpicSchema), async (req, res, next) => {
  try {
    res.status(201).json(await createEpic(getValidated<typeof CreateEpicSchema._type>(req)));
  } catch (e) {
    next(e);
  }
});

epicsRouter.patch('/:id', validate(UpdateEpicSchema), async (req, res, next) => {
  try {
    res.json(await updateEpic(req.params.id!, getValidated<typeof UpdateEpicSchema._type>(req)));
  } catch (e) {
    next(e);
  }
});

epicsRouter.delete('/:id', async (req, res, next) => {
  try {
    await deleteEpic(req.params.id!);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
