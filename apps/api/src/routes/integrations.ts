import { Router } from 'express';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import multer from 'multer';
import {
  ConnectIntegrationSchema,
  IntegrationKindParam,
  INTEGRATION_KINDS,
} from '@allebrum/shared';
import type { IntegrationKind } from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { requirePermission, requireAnyPermission } from '../auth/permissions.js';
import { validate, getValidated } from '../middleware/validate.js';
import { HttpError } from '../middleware/errorHandler.js';
import { env } from '../env.js';
import {
  listIntegrations,
  connect,
  disconnect,
  update,
} from '../services/integrations.js';
import {
  getDriveStatus,
  buildDriveConsentUrl,
  exchangeDriveCode,
  saveDriveToken,
  disconnectDrive,
  ensureSharedFolder,
  listFolder,
  folderPath,
  createFolder,
  uploadFile,
  getFileMeta,
  downloadFile,
  deleteEntry,
  driveConfigured,
} from '../services/drive.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// Drive/Media is reachable by anyone holding EITHER permission.
const driveAccess = requireAnyPermission('integrations.manage', 'media.manage');

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
  requirePermission('integrations.manage'),
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

integrationsRouter.post('/:kind/disconnect', requirePermission('integrations.manage'), async (req, res, next) => {
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
  requirePermission('integrations.manage'),
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

// ---- Google Drive (real) ----
integrationsRouter.get('/drive/status', async (_req, res, next) => {
  try {
    res.json(await getDriveStatus());
  } catch (e) {
    next(e);
  }
});

integrationsRouter.get('/drive/connect', driveAccess, async (req, res, next) => {
  try {
    if (!driveConfigured()) {
      res.status(404).json({ error: 'drive_oauth_not_configured' });
      return;
    }
    const state = randomBytes(16).toString('hex');
    req.session.oauthState = state;
    req.session.save((err) => {
      if (err) return next(err);
      res.redirect(buildDriveConsentUrl(state));
    });
  } catch (e) {
    next(e);
  }
});

integrationsRouter.get('/drive/callback', async (req, res, next) => {
  const back = (q: string) => res.redirect(`${env.WEB_ORIGIN}/media?drive=${q}`);
  try {
    const me = req.session.user;
    if (!me) return back('error');
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !state || state !== req.session.oauthState) return back('bad_state');
    delete req.session.oauthState;
    const tokens = await exchangeDriveCode(code);
    await saveDriveToken(me.userId, tokens);
    await ensureSharedFolder();
    return back('connected');
  } catch {
    return back('error');
  }
});

integrationsRouter.post('/drive/disconnect', driveAccess, async (_req, res, next) => {
  try {
    await disconnectDrive();
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

const ListQuery = z.object({ folderId: z.string().optional() });
integrationsRouter.get(
  '/drive/list',
  driveAccess,
  validate(ListQuery, 'query'),
  async (req, res, next) => {
    try {
      const q = getValidated<typeof ListQuery._type>(req, 'query');
      const folderId = q.folderId || (await ensureSharedFolder());
      const [entries, path] = await Promise.all([listFolder(folderId), folderPath(folderId)]);
      res.json({ folderId, path, entries });
    } catch (e) {
      next(e);
    }
  },
);

const CreateFolderSchema = z.object({ parentId: z.string().min(1), name: z.string().min(1).max(200) });
integrationsRouter.post(
  '/drive/folders',
  driveAccess,
  validate(CreateFolderSchema),
  async (req, res, next) => {
    try {
      const { parentId, name } = getValidated<typeof CreateFolderSchema._type>(req);
      res.status(201).json(await createFolder(parentId, name));
    } catch (e) {
      next(e);
    }
  },
);

integrationsRouter.post(
  '/drive/upload',
  driveAccess,
  upload.single('file'),
  async (req, res, next) => {
    try {
      const file = (req as unknown as { file?: Express.Multer.File }).file;
      const parentId = typeof req.body?.parentId === 'string' ? req.body.parentId : '';
      if (!file || !parentId) {
        res.status(400).json({ error: 'file_and_parent_required' });
        return;
      }
      const entry = await uploadFile(parentId, file.originalname, file.mimetype, file.buffer);
      res.status(201).json(entry);
    } catch (e) {
      next(e);
    }
  },
);

integrationsRouter.get('/drive/file/:id/download', requirePermission('media.manage'), async (req, res, next) => {
  try {
    const id = req.params.id!;
    const meta = await getFileMeta(id);
    const stream = await downloadFile(id);
    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(meta.name ?? 'download')}"`,
    );
    stream.pipe(res);
  } catch (e) {
    next(e);
  }
});

integrationsRouter.delete('/drive/file/:id', requirePermission('media.manage'), async (req, res, next) => {
  try {
    await deleteEntry(req.params.id!);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
