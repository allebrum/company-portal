import { Router } from 'express';
import { CreateProjectSchema, UpdateProjectSchema } from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { userCan } from '../auth/permissions.js';
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

// Any authenticated teammate can create a project (e.g. inline from the
// composer while creating a goal/to-do). Editing/renaming stays gated by
// projects.manage below.
projectsRouter.post('/', validate(CreateProjectSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const row = await createProject(getValidated<typeof CreateProjectSchema._type>(req), me.userId);
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

projectsRouter.patch('/:id', validate(UpdateProjectSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const patch = getValidated<typeof UpdateProjectSchema._type>(req);
    const keys = Object.keys(patch);
    const notesOnlyPatch = keys.every((k) => k === 'spaceBlocks' || k === 'spaceFiles');
    if (!notesOnlyPatch && !(await userCan(req, 'projects.manage'))) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    const row = await updateProject(req.params.id!, patch, me.userId);
    res.json(row);
  } catch (e) {
    next(e);
  }
});
