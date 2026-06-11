import { Router } from 'express';
import { authRouter } from './auth.js';
import { usersRouter } from './users.js';
import { clientsRouter } from './clients.js';
import { projectsRouter } from './projects.js';
import { goalsRouter } from './goals.js';
import { epicsRouter } from './epics.js';
import { milestonesRouter } from './milestones.js';
import { todosRouter } from './todos.js';
import { ticketsRouter } from './tickets.js';
import { entriesRouter } from './entries.js';
import { payPeriodsRouter } from './payPeriods.js';
import { payConfigRouter } from './payConfig.js';
import { activityRouter } from './activity.js';
import { integrationsRouter } from './integrations.js';
import { spacesRouter } from './spaces.js';
import { portalRouter } from './portal.js';
import { qrRouter, qrPublicRouter } from './qr.js';
import { uploadQrRouter } from './uploadQr.js';
import { bootstrapRouter } from './bootstrap.js';
import { onboardingRouter } from './onboarding.js';
import { rbacRouter } from './rbac.js';
import { settingsRouter } from './settings.js';
import { twofaRouter } from './twofa.js';
import { tenantContext } from '../middleware/tenantContext.js';
import { requireActiveSubscription } from '../middleware/requireActiveSubscription.js';
import { provisioningRouter } from './provisioning.js';
import { billingRouter } from './billing.js';
import { provisioningConfigured } from '../env.js';

export const apiRouter = Router();

apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Hoppa: bind the request's active workspace (from session.user.tenantId) to
// an AsyncLocalStorage context for all downstream services. No-op for routes
// reached before login (auth, public portal/QR) — they pass through and any
// service that needs a tenant will throw, which is correct for those paths.
apiRouter.use(tenantContext);
// Hoppa: gate business routes on the workspace's subscription. Exempts auth /
// billing / provisioning / portal / public; no-ops to "allow" when billing
// isn't configured. Lapsed workspaces get 402 on everything else.
apiRouter.use(requireActiveSubscription);

apiRouter.use('/auth', authRouter);
apiRouter.use('/auth', twofaRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/clients', clientsRouter);
apiRouter.use('/projects', projectsRouter);
apiRouter.use('/goals', goalsRouter);
apiRouter.use('/epics', epicsRouter);
apiRouter.use('/milestones', milestonesRouter);
apiRouter.use('/todos', todosRouter);
apiRouter.use('/tickets', ticketsRouter);
apiRouter.use('/entries', entriesRouter);
apiRouter.use('/pay-periods', payPeriodsRouter);
apiRouter.use('/pay-config', payConfigRouter);
apiRouter.use('/activity', activityRouter);
apiRouter.use('/integrations', integrationsRouter);
apiRouter.use('/spaces', spacesRouter);
apiRouter.use('/portal', portalRouter);
apiRouter.use('/qr', qrRouter);
apiRouter.use('/q', qrPublicRouter);
apiRouter.use('/upload/qr', uploadQrRouter);
apiRouter.use('/bootstrap', bootstrapRouter);
apiRouter.use('/onboarding', onboardingRouter);
apiRouter.use('/rbac', rbacRouter);
apiRouter.use('/settings', settingsRouter);
// Hoppa Phase 3: billing portal (session-gated, subscription-exempt) +
// provisioning webhook (HMAC-gated, only mounted when the secret is set).
apiRouter.use('/billing', billingRouter);
if (provisioningConfigured) {
  apiRouter.use('/provisioning', provisioningRouter);
}
