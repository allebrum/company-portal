import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { CreateApiTokenSchema, type CreateApiTokenInput } from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate, getValidated } from '../middleware/validate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { createToken, listTokens, revokeToken } from '../services/apiTokens.js';
import { isTokenRequest } from '../middleware/bearerAuth.js';

/**
 * Personal access token management — `/api/api-tokens`.
 *
 * Create / list / revoke are browser-session only: a token can never mint,
 * list, or revoke tokens (bearerAuth's allow-list already blocks these, and
 * `sessionOnly` double-checks). `GET /current` is the one token-reachable
 * route: a bot's "who am I / what can I do".
 */
export const apiTokensRouter = Router();
apiTokensRouter.use(requireAuth);

apiTokensRouter.get('/current', (req, res) => {
  const me = req.session.user!;
  res.json({
    userId: me.userId,
    tenantId: me.tenantId,
    via: isTokenRequest(req) ? 'token' : 'session',
    tokenId: req.apiToken?.id ?? null,
    scopes: req.apiToken?.scopes ?? null,
  });
});

const sessionOnly: RequestHandler = (req, res, next) => {
  if (isTokenRequest(req)) {
    res.status(403).json({ error: 'session_required' });
    return;
  }
  next();
};

apiTokensRouter.get('/', sessionOnly, async (req, res, next) => {
  try {
    const me = req.session.user!;
    res.json(await listTokens(me.userId, me.tenantId));
  } catch (e) {
    next(e);
  }
});

apiTokensRouter.post(
  '/',
  sessionOnly,
  rateLimit({ key: 'pat-create', max: 10, windowSec: 3600 }),
  validate(CreateApiTokenSchema),
  async (req, res, next) => {
    try {
      const me = req.session.user!;
      const created = await createToken(me.userId, me.tenantId, getValidated<CreateApiTokenInput>(req));
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json(created);
    } catch (e) {
      next(e);
    }
  },
);

const IdParams = z.object({ id: z.string().uuid() });

apiTokensRouter.delete('/:id', sessionOnly, validate(IdParams, 'params'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    await revokeToken(me.userId, me.tenantId, req.params.id!);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
