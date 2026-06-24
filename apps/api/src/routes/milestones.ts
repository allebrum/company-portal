import { Router } from 'express';
import { CreateMilestoneSchema, UpdateMilestoneSchema } from '@modernzen/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate, getValidated } from '../middleware/validate.js';
import { listMilestones, createMilestone, updateMilestone, deleteMilestone } from '../services/milestones.js';

export const milestonesRouter = Router();
milestonesRouter.use(requireAuth);

milestonesRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await listMilestones());
  } catch (e) {
    next(e);
  }
});

milestonesRouter.post('/', validate(CreateMilestoneSchema), async (req, res, next) => {
  try {
    res.status(201).json(await createMilestone(getValidated<typeof CreateMilestoneSchema._type>(req)));
  } catch (e) {
    next(e);
  }
});

milestonesRouter.patch('/:id', validate(UpdateMilestoneSchema), async (req, res, next) => {
  try {
    res.json(await updateMilestone(req.params.id!, getValidated<typeof UpdateMilestoneSchema._type>(req)));
  } catch (e) {
    next(e);
  }
});

milestonesRouter.delete('/:id', async (req, res, next) => {
  try {
    await deleteMilestone(req.params.id!);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
