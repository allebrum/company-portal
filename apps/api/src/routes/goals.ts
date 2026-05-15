import { Router } from 'express';
import {
  CreateGoalSchema,
  UpdateGoalSchema,
  MoveGoalSchema,
  AddResourceSchema,
} from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate, getValidated } from '../middleware/validate.js';
import {
  listGoals,
  createGoal,
  updateGoal,
  moveGoal,
  addResource,
  removeResource,
} from '../services/goals.js';

export const goalsRouter = Router();

goalsRouter.use(requireAuth);

goalsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await listGoals());
  } catch (e) {
    next(e);
  }
});

goalsRouter.post('/', validate(CreateGoalSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await createGoal(getValidated<typeof CreateGoalSchema._type>(req), me.userId);
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

goalsRouter.patch('/:id', validate(UpdateGoalSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await updateGoal(req.params.id!, getValidated<typeof UpdateGoalSchema._type>(req), me.userId);
    res.json(row);
  } catch (e) {
    next(e);
  }
});

goalsRouter.patch('/:id/status', validate(MoveGoalSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await moveGoal(req.params.id!, getValidated<typeof MoveGoalSchema._type>(req), me.userId);
    res.json(row);
  } catch (e) {
    next(e);
  }
});

goalsRouter.post('/:id/resources', validate(AddResourceSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await addResource(req.params.id!, getValidated<typeof AddResourceSchema._type>(req), me.userId);
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

goalsRouter.delete('/:id/resources/:rid', async (req, res, next) => {
  try {
    const me = req.session.user!;
    await removeResource(req.params.id!, req.params.rid!, me.userId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
