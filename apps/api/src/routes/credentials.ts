import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import {
  CreateCredentialSchema,
  SetCredentialAllowlistSchema,
  UpdateCredentialSchema,
  type CreateCredentialInput,
  type SetCredentialAllowlistInput,
  type UpdateCredentialInput,
} from '@allebrum/shared';
import { loadPermissions, requirePermission } from '../auth/permissions.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { getValidated, validate } from '../middleware/validate.js';
import { credentialRevealLimiter, credentialsRouteLimiter } from '../middleware/rateLimiters.js';
import { HttpError } from '../middleware/errorHandler.js';
import * as svc from '../services/credentials.js';

/**
 * Project / client credentials vault — `/api/credentials`.
 *
 * Values are returned ONLY by `POST /:id/reveal` (one credential per call,
 * rate-limited, audited). Every response is `Cache-Control: no-store`.
 * Allowlist + access-log routes need workspace-wide `credentials.manage` and
 * are browser-session only (see middleware/tokenPolicy.ts).
 */
export const credentialsRouter = Router();

credentialsRouter.use(requireAuth);
credentialsRouter.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  next();
});

async function actorFor(req: Request): Promise<svc.CredentialActor> {
  const me = req.session.user!;
  return {
    userId: me.userId,
    perms: await loadPermissions(req),
    token: req.apiToken ? { id: req.apiToken.id, name: req.apiToken.name, scopes: req.apiToken.scopes } : null,
    ip: req.ip ?? null,
    userAgent: req.get('user-agent') ?? null,
  };
}

const ScopeQuery = z
  .object({ clientId: z.string().uuid().optional(), projectId: z.string().uuid().optional() })
  .refine((v) => !!v.clientId !== !!v.projectId, { message: 'Provide exactly one of clientId or projectId' });

const revealLimiter = credentialRevealLimiter(async (req) => {
  try {
    await svc.logRateLimitedReveal(await actorFor(req), String(req.params.id ?? ''));
  } catch {
    // audit is best-effort here; the 429 is still sent
  }
});

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

// Reveal first so its limiter doesn't also count toward the general limiter.
credentialsRouter.post(
  '/:id/reveal',
  revealLimiter,
  wrap(async (req, res) => {
    res.json(await svc.revealCredential(await actorFor(req), req.params.id!));
  }),
);

credentialsRouter.use(credentialsRouteLimiter);

/** What the caller may do on one client/project (drives tab visibility). Always 200. */
credentialsRouter.get(
  '/access',
  validate(ScopeQuery, 'query'),
  wrap(async (req, res) => {
    const q = getValidated<z.infer<typeof ScopeQuery>>(req, 'query');
    const owner = await svc.resolveScope(q);
    res.json(await svc.accessFor(await actorFor(req), owner.clientId));
  }),
);

credentialsRouter.get(
  '/',
  validate(ScopeQuery, 'query'),
  wrap(async (req, res) => {
    const q = getValidated<z.infer<typeof ScopeQuery>>(req, 'query');
    const owner = await svc.resolveScope(q);
    const access = await svc.accessFor(await actorFor(req), owner.clientId);
    if (!access.canView) throw new HttpError(403, 'forbidden');
    res.json({ access, credentials: await svc.listCredentials(owner) });
  }),
);

credentialsRouter.post(
  '/',
  validate(CreateCredentialSchema),
  wrap(async (req, res) => {
    const input = getValidated<CreateCredentialInput>(req);
    res.status(201).json(await svc.createCredential(await actorFor(req), input));
  }),
);

credentialsRouter.patch(
  '/:id',
  validate(UpdateCredentialSchema),
  wrap(async (req, res) => {
    const patch = getValidated<UpdateCredentialInput>(req);
    res.json(await svc.updateCredential(await actorFor(req), req.params.id!, patch));
  }),
);

credentialsRouter.delete(
  '/:id',
  wrap(async (req, res) => {
    await svc.deleteCredential(await actorFor(req), req.params.id!);
    res.json({ ok: true });
  }),
);

// ---- allowlist + access log: workspace-wide credentials.manage (Owner), session only

const ClientParam = z.object({ clientId: z.string().uuid() });

credentialsRouter.get(
  '/clients/:clientId/allowlist',
  requirePermission('credentials.manage'),
  validate(ClientParam, 'params'),
  wrap(async (req, res) => {
    res.json(await svc.getAllowlist(req.params.clientId!));
  }),
);

credentialsRouter.put(
  '/clients/:clientId/allowlist',
  requirePermission('credentials.manage'),
  validate(ClientParam, 'params'),
  validate(SetCredentialAllowlistSchema),
  wrap(async (req, res) => {
    const input = getValidated<SetCredentialAllowlistInput>(req);
    const entries = input.entries.map((e) => ({ userId: e.userId, canManage: e.canManage ?? false }));
    res.json(await svc.setAllowlist(await actorFor(req), req.params.clientId!, entries));
  }),
);

const LogQuery = z.object({
  clientId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

credentialsRouter.get(
  '/access-log',
  requirePermission('credentials.manage'),
  validate(LogQuery, 'query'),
  wrap(async (req, res) => {
    res.json(await svc.listAccessLog(getValidated<z.infer<typeof LogQuery>>(req, 'query')));
  }),
);
