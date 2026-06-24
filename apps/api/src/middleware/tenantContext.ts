import type { Request, Response, NextFunction } from 'express';
import { withTenant } from '../tenancy/context.js';

/**
 * Modern Zen multi-tenancy — bind the request's active workspace to an
 * AsyncLocalStorage context so downstream services can read
 * `currentTenantId()` without threading it through every signature.
 *
 * Mount AFTER `requireAuth` on the business routers. If there's no tenant on
 * the session (e.g. a route reached before login, or a user with no
 * workspace yet) it passes through without a context — services that require
 * a tenant will throw, which is the correct failure for those routes.
 */
export function tenantContext(req: Request, res: Response, next: NextFunction): void {
  const tenantId = req.session?.user?.tenantId;
  if (!tenantId) {
    next();
    return;
  }
  withTenant(tenantId, () => next());
}
