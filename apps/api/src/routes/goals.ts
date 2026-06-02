import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
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
  uploadGoalResource,
  renameGoalResource,
} from '../services/goals.js';

// Same limit as the Drive media manager (100 MB). In-memory; we hand the
// buffer straight to the Drive upload, no on-disk staging.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

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

// Multipart-upload variant: drag-drop / file-picker on the client uploads a
// real file, the API pushes it into the goal's project Drive folder, then
// records a resource row carrying the resulting Drive file metadata.
goalsRouter.post('/:id/resources/upload', upload.single('file'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: 'file_required' });
      return;
    }
    const row = await uploadGoalResource(req.params.id!, file, me.userId);
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

const RenameGoalResourceSchema = z.object({ title: z.string().trim().min(1).max(240) });
goalsRouter.patch('/:id/resources/:rid', validate(RenameGoalResourceSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const input = getValidated<typeof RenameGoalResourceSchema._type>(req);
    const row = await renameGoalResource(req.params.id!, req.params.rid!, input.title, me.userId);
    res.json(row);
  } catch (e) {
    next(e);
  }
});
