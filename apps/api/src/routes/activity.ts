import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate, getValidated } from '../middleware/validate.js';
import { listActivity } from '../services/activity.js';

export const activityRouter = Router();

activityRouter.use(requireAuth);

const QuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(30),
});

activityRouter.get('/', validate(QuerySchema, 'query'), async (req, res, next) => {
  try {
    const { limit } = getValidated<typeof QuerySchema._type>(req, 'query');
    res.json(await listActivity(limit));
  } catch (e) {
    next(e);
  }
});
