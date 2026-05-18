import { Router } from 'express';
import { LoginSchema } from '@allebrum/shared';
import { validate, getValidated } from '../middleware/validate.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { verifyLogin, getUser } from '../services/users.js';
import { getEffectivePermissions } from '../auth/permissions.js';
import { getUserGroupIds } from '../services/rbac.js';

export const authRouter = Router();

authRouter.post('/login', rateLimit({ key: 'login', max: 10, windowSec: 60 }), validate(LoginSchema), async (req, res, next) => {
  try {
    const { email, password } = getValidated<typeof LoginSchema._type>(req);
    const user = await verifyLogin(email, password);
    if (!user) {
      res.status(401).json({ error: 'invalid_credentials' });
      return;
    }
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.user = { userId: user.id };
      req.session.save(async (saveErr) => {
        if (saveErr) return next(saveErr);
        const permissions = [...(await getEffectivePermissions(user.id))];
        res.json({
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            initials: user.initials,
            color: user.color,
            billable: Number(user.billable),
            permissions,
          },
        });
      });
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post('/logout', requireAuth, (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

authRouter.get('/me', requireAuth, async (req, res, next) => {
  try {
    const u = await getUser(req.session.user!.userId);
    if (!u) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const [permissions, groupIds] = await Promise.all([
      getEffectivePermissions(u.id),
      getUserGroupIds(u.id),
    ]);
    res.json({
      id: u.id,
      name: u.name,
      email: u.email,
      initials: u.initials,
      color: u.color,
      billable: Number(u.billable),
      permissions: [...permissions],
      groupIds,
    });
  } catch (e) {
    next(e);
  }
});
