import { Router } from 'express';
import { InviteUserSchema, UpdateUserSchema } from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { requirePermission, userCan } from '../auth/permissions.js';
import { validate, getValidated } from '../middleware/validate.js';
import { HttpError } from '../middleware/errorHandler.js';
import { listUsers, inviteUser, updateUser, deleteUser, resendInvite } from '../services/users.js';
import { setUserGroups } from '../services/rbac.js';

export const usersRouter = Router();

usersRouter.use(requireAuth);

usersRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await listUsers());
  } catch (e) {
    next(e);
  }
});

usersRouter.post('/', requirePermission('users.manage'), validate(InviteUserSchema), async (req, res, next) => {
  try {
    const input = getValidated<typeof InviteUserSchema._type>(req);
    const me = req.session.user!;
    const row = await inviteUser({
      name: input.name,
      email: input.email,
      billable: input.billable,
      color: input.color,
      sendInvite: input.sendInvite,
      whoId: me.userId,
    });
    if (input.groupIds.length > 0) {
      await setUserGroups(row.id, input.groupIds, me.userId);
    }
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

// Re-issue an invite token + email for a still-`invited` user. Invalidates
// any prior unused invite tokens so older links stop working immediately.
usersRouter.post('/:id/resend-invite', requirePermission('users.manage'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    await resendInvite(req.params.id!, me.userId);
    res.json({ ok: true });
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
    const canManage = await userCan(req, 'users.manage');

    if (!isSelf && !canManage) throw new HttpError(403, 'forbidden');

    // Members editing themselves cannot change billable rate or group membership.
    if (isSelf && !canManage) {
      delete patch.billable;
      delete patch.groupIds;
    }
    const { groupIds, ...userPatch } = patch;
    const row = await updateUser(id, userPatch, me.userId);
    if (groupIds && canManage) {
      await setUserGroups(id, groupIds, me.userId);
    }
    res.json(row);
  } catch (e) {
    next(e);
  }
});

usersRouter.delete('/:id', requirePermission('users.manage'), async (req, res, next) => {
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
