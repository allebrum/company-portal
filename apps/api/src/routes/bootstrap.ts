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

export const bootstrapRouter = Router();

bootstrapRouter.use(requireAuth);

bootstrapRouter.get('/', async (req, res, next) => {
  try {
    const me = req.session.user!;
    const [
      meRow,
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
    ] = await Promise.all([
      getUser(me.userId),
      listUsers(),
      listClients(),
      listProjects(),
      listGoals(),
      listVisibleTodos(me.userId),
      listEntries(me.userId, me.role, { limit: 500 }),
      listActiveTimers(),
      listPeriods(),
      getConfig(),
      listIntegrations(),
      listDriveFolders(),
      listDriveItems(),
      listActivity(30),
    ]);
    res.json({
      me: meRow,
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
    });
  } catch (e) {
    next(e);
  }
});
