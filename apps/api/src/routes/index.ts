import { Router } from 'express';
import { authRouter } from './auth.js';
import { usersRouter } from './users.js';
import { clientsRouter } from './clients.js';
import { projectsRouter } from './projects.js';
import { goalsRouter } from './goals.js';
import { epicsRouter } from './epics.js';
import { milestonesRouter } from './milestones.js';
import { todosRouter } from './todos.js';
import { entriesRouter } from './entries.js';
import { payPeriodsRouter } from './payPeriods.js';
import { payConfigRouter } from './payConfig.js';
import { activityRouter } from './activity.js';
import { integrationsRouter } from './integrations.js';
import { bootstrapRouter } from './bootstrap.js';
import { rbacRouter } from './rbac.js';
import { settingsRouter } from './settings.js';
import { twofaRouter } from './twofa.js';
import { policiesRouter } from './policies.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/auth', twofaRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/clients', clientsRouter);
apiRouter.use('/projects', projectsRouter);
apiRouter.use('/goals', goalsRouter);
apiRouter.use('/epics', epicsRouter);
apiRouter.use('/milestones', milestonesRouter);
apiRouter.use('/todos', todosRouter);
apiRouter.use('/entries', entriesRouter);
apiRouter.use('/pay-periods', payPeriodsRouter);
apiRouter.use('/pay-config', payConfigRouter);
apiRouter.use('/activity', activityRouter);
apiRouter.use('/integrations', integrationsRouter);
apiRouter.use('/bootstrap', bootstrapRouter);
apiRouter.use('/rbac', rbacRouter);
apiRouter.use('/settings', settingsRouter);
apiRouter.use('/policies', policiesRouter);
