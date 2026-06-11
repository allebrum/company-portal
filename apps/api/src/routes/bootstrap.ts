import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { listUsers, getUser } from '../services/users.js';
import { listClients } from '../services/clients.js';
import { listProjects } from '../services/projects.js';
import { listGoals } from '../services/goals.js';
import { listVisibleTodos } from '../services/todos.js';
import { listEntries, listActiveTimers } from '../services/entries.js';
import { listPeriods } from '../services/payPeriods.js';
import { getConfig } from '../services/payConfig.js';
import { listIntegrations, listDriveFolders, listDriveItems } from '../services/integrations.js';
import { listActivity } from '../services/activity.js';
import { getEffectivePermissions } from '../auth/permissions.js';
import { getUserGroupIds } from '../services/rbac.js';
import { getTenant } from '../services/tenants.js';
import { billingEnforced } from '../env.js';

export const bootstrapRouter = Router();

bootstrapRouter.use(requireAuth);

bootstrapRouter.get('/', async (req, res, next) => {
  try {
    const me = req.session.user!;
    const permSet = await getEffectivePermissions(me.userId, me.tenantId);
    const canViewAll = permSet.has('time_entry.view_all');
    const [
      meRow,
      groupIds,
      users,
      clients,
      projects,
      goals,
      todos,
      entries,
      timers,
      payPeriods,
      payConfig,
      integrations,
      driveFolders,
      driveItems,
      activity,
      tenant,
    ] = await Promise.all([
      getUser(me.userId),
      getUserGroupIds(me.userId),
      listUsers(),
      listClients(),
      listProjects(),
      listGoals(),
      listVisibleTodos(me.userId),
      listEntries(me.userId, canViewAll, { limit: 500 }),
      listActiveTimers(),
      listPeriods(),
      getConfig(),
      listIntegrations(),
      listDriveFolders(),
      listDriveItems(),
      listActivity(30),
      getTenant(me.tenantId),
    ]);
    res.json({
      me: meRow ? { ...meRow, permissions: [...permSet], groupIds } : null,
      users,
      clients,
      projects,
      goals,
      todos,
      entries,
      timers,
      payPeriods,
      payConfig,
      integrations,
      driveFolders,
      driveItems,
      activity,
      // Billing surface for in-app pre-warnings (trial countdown banner).
      // Null when billing isn't enforced (self-host) or the workspace is
      // exempt — the web renders no banner in that case. past_due/canceled
      // never reach here (the subscription gate 402s bootstrap first).
      billing:
        billingEnforced && tenant && !tenant.billingExempt
          ? {
              status: tenant.billingStatus,
              trialEndsAt: tenant.trialEndsAt,
              hasPaymentMethod: !!tenant.stripePaymentMethodId,
            }
          : null,
    });
  } catch (e) {
    next(e);
  }
});
