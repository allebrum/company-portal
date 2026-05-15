import { Router } from 'express';
import { CreateProjectSchema, UpdateProjectSchema } from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate, getValidated } from '../middleware/validate.js';
import { listProjects, createProject, updateProject } from '../services/projects.js';

export const projectsRouter = Router();

projectsRouter.use(requireAuth);

projectsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await listProjects());
  } catch (e) {
    next(e);
  }
});

projectsRouter.post('/', requireRole('owner', 'admin'), validate(CreateProjectSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await createProject(getValidated<typeof CreateProjectSchema._type>(req), me.userId);
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

projectsRouter.patch('/:id', requireRole('owner', 'admin'), validate(UpdateProjectSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await updateProject(req.params.id!, getValidated<typeof UpdateProjectSchema._type>(req), me.userId);
    res.json(row);
  } catch (e) {
    next(e);
  }
});
