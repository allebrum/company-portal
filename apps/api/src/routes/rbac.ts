import { Router } from 'express';
import {
  CreateGroupSchema,
  UpdateGroupSchema,
  SetGroupPermissionsSchema,
  SetUserGroupsSchema,
  SetUserOverridesSchema,
} from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { requirePermission } from '../auth/permissions.js';
import { validate, getValidated } from '../middleware/validate.js';
import {
  listPermissions,
  listGroups,
  createGroup,
  updateGroup,
  deleteGroup,
  setGroupPermissions,
  getUserGroupIds,
  setUserGroups,
  getUserOverrides,
  setUserOverrides,
} from '../services/rbac.js';

export const rbacRouter = Router();

rbacRouter.use(requireAuth);

// Catalog + group list are readable by anyone authenticated (UI needs them);
// all mutations require groups.manage.
rbacRouter.get('/permissions', async (_req, res, next) => {
  try {
    res.json(await listPermissions());
  } catch (e) {
    next(e);
  }
});

rbacRouter.get('/groups', async (_req, res, next) => {
  try {
    res.json(await listGroups());
  } catch (e) {
    next(e);
  }
});

rbacRouter.post('/groups', requirePermission('groups.manage'), validate(CreateGroupSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    res.status(201).json(await createGroup(getValidated<typeof CreateGroupSchema._type>(req), me.userId));
  } catch (e) {
    next(e);
  }
});

rbacRouter.patch('/groups/:id', requirePermission('groups.manage'), validate(UpdateGroupSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    res.json(await updateGroup(req.params.id!, getValidated<typeof UpdateGroupSchema._type>(req), me.userId));
  } catch (e) {
    next(e);
  }
});

rbacRouter.delete('/groups/:id', requirePermission('groups.manage'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    await deleteGroup(req.params.id!, me.userId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

rbacRouter.put(
  '/groups/:id/permissions',
  requirePermission('groups.manage'),
  validate(SetGroupPermissionsSchema),
  async (req, res, next) => {
    try {
      const me = req.session.user!;
      await setGroupPermissions(
        req.params.id!,
        getValidated<typeof SetGroupPermissionsSchema._type>(req).permissions,
        me.userId,
      );
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

rbacRouter.get('/users/:id/groups', async (req, res, next) => {
  try {
    res.json(await getUserGroupIds(req.params.id!));
  } catch (e) {
    next(e);
  }
});

rbacRouter.put(
  '/users/:id/groups',
  requirePermission('users.manage'),
  validate(SetUserGroupsSchema),
  async (req, res, next) => {
    try {
      const me = req.session.user!;
      await setUserGroups(req.params.id!, getValidated<typeof SetUserGroupsSchema._type>(req).groupIds, me.userId);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

rbacRouter.get('/users/:id/overrides', requirePermission('users.manage'), async (req, res, next) => {
  try {
    res.json(await getUserOverrides(req.params.id!));
  } catch (e) {
    next(e);
  }
});

rbacRouter.put(
  '/users/:id/overrides',
  requirePermission('users.manage'),
  validate(SetUserOverridesSchema),
  async (req, res, next) => {
    try {
      const me = req.session.user!;
      await setUserOverrides(
        req.params.id!,
        getValidated<typeof SetUserOverridesSchema._type>(req).overrides,
        me.userId,
      );
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);
