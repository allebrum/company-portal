import { Router } from 'express';
import { InviteUserSchema, UpdateUserSchema } from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate, getValidated } from '../middleware/validate.js';
import { HttpError } from '../middleware/errorHandler.js';
import { listUsers, inviteUser, updateUser, deleteUser } from '../services/users.js';

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await listUsers());
  } catch (e) {
    next(e);
  }
});

usersRouter.post('/', requireRole('owner', 'admin'), validate(InviteUserSchema), async (req, res, next) => {
  try {
    const input = getValidated<typeof InviteUserSchema._type>(req);
    const me = req.session.user!;
    const row = await inviteUser({
      name: input.name,
      email: input.email,
      role: input.role,
      password: input.password,
      billable: input.billable,
      color: input.color,
      whoId: me.userId,
    });
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

usersRouter.patch('/:id', validate(UpdateUserSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const id = req.params.id!;
    const patch = getValidated<typeof UpdateUserSchema._type>(req);
    const isSelf = id === me.userId;
    const isPrivileged = me.role === 'owner' || me.role === 'admin';

    if (!isSelf && !isPrivileged) throw new HttpError(403, 'forbidden');

    // Members editing themselves cannot touch role or billable.
    if (isSelf && !isPrivileged) {
      delete patch.role;
      delete patch.billable;
    }
    const row = await updateUser(id, patch, me.userId);
    res.json(row);
  } catch (e) {
    next(e);
  }
});

usersRouter.delete('/:id', requireRole('owner'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const id = req.params.id!;
    if (id === me.userId) throw new HttpError(400, 'cannot_delete_self');
    await deleteUser(id, me.userId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
