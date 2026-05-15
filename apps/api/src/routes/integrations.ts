import { Router } from 'express';
import { z } from 'zod';
import {
  ConnectIntegrationSchema,
  IntegrationKindParam,
  LinkFolderSchema,
  INTEGRATION_KINDS,
} from '@allebrum/shared';
import type { IntegrationKind } from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate, getValidated } from '../middleware/validate.js';
import { HttpError } from '../middleware/errorHandler.js';
import {
  listIntegrations,
  connect,
  disconnect,
  update,
  syncDrive,
  listDriveFolders,
  linkDriveFolder,
  unlinkDriveFolder,
  listDriveItems,
} from '../services/integrations.js';

export const integrationsRouter = Router();

integrationsRouter.use(requireAuth);

integrationsRouter.get('/', async (_req, res, next) => {
  try {
    res.json(await listIntegrations());
  } catch (e) {
    next(e);
  }
});

const KindParam = z.object({ kind: z.enum(INTEGRATION_KINDS) });
void IntegrationKindParam;

function kindFromParam(raw: string): IntegrationKind {
  const parsed = KindParam.safeParse({ kind: raw });
  if (!parsed.success) throw new HttpError(400, 'invalid_kind');
  return parsed.data.kind;
}

integrationsRouter.post(
  '/:kind/connect',
  requireRole('owner', 'admin'),
  validate(ConnectIntegrationSchema),
  async (req, res, next) => {
    try {
      const me = req.session.user!;
      const kind = kindFromParam(req.params.kind!);
      const row = await connect(kind, getValidated<typeof ConnectIntegrationSchema._type>(req), me.userId);
      res.json(row);
    } catch (e) {
      next(e);
    }
  },
);

integrationsRouter.post('/:kind/disconnect', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const kind = kindFromParam(req.params.kind!);
    const row = await disconnect(kind, me.userId);
    res.json(row);
  } catch (e) {
    next(e);
  }
});

integrationsRouter.patch(
  '/:kind',
  requireRole('owner', 'admin'),
  validate(ConnectIntegrationSchema),
  async (req, res, next) => {
    try {
      const me = req.session.user!;
      const kind = kindFromParam(req.params.kind!);
      const row = await update(kind, getValidated<typeof ConnectIntegrationSchema._type>(req), me.userId);
      res.json(row);
    } catch (e) {
      next(e);
    }
  },
);

// Drive-specific
integrationsRouter.post('/drive/sync', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    res.json(await syncDrive(me.userId));
  } catch (e) {
    next(e);
  }
});

integrationsRouter.get('/drive/folders', async (_req, res, next) => {
  try {
    res.json(await listDriveFolders());
  } catch (e) {
    next(e);
  }
});

integrationsRouter.post(
  '/drive/folders',
  requireRole('owner', 'admin'),
  validate(LinkFolderSchema),
  async (req, res, next) => {
    try {
      const me = req.session.user!;
      const row = await linkDriveFolder(getValidated<typeof LinkFolderSchema._type>(req), me.userId);
      res.status(201).json(row);
    } catch (e) {
      next(e);
    }
  },
);

integrationsRouter.delete('/drive/folders/:id', requireRole('owner', 'admin'), async (req, res, next) => {
  try {
    const me = req.session.user!;
    await unlinkDriveFolder(req.params.id!, me.userId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

const ItemsQuery = z.object({ folderId: z.string().uuid().optional() });
integrationsRouter.get('/drive/items', validate(ItemsQuery, 'query'), async (req, res, next) => {
  try {
    const q = getValidated<typeof ItemsQuery._type>(req, 'query');
    res.json(await listDriveItems(q.folderId));
  } catch (e) {
    next(e);
  }
});
