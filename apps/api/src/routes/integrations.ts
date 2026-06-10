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
  ensureSharedFolder,
  listFolder,
  folderPath,
  createFolder,
  uploadFile,
  getFileMeta,
  downloadFile,
  deleteEntry,
  renameEntry,
  driveConfigured,
  reconcileFolders,
} from '../services/drive.js';
import {
  buildGmailConsentUrl,
  exchangeGmailCode,
  saveGmailToken,
  disconnectGmail,
  getGmailStatusForUser,
  gmailConfigured,
  listGmailConnectedUserIds,
} from '../services/gmail.js';
import { listUsers } from '../services/users.js';

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
    // Same-origin path-only return (no scheme / no `//host`) so the gate can
    // bounce the user back to where they triggered the connect.
    const rawReturnTo = typeof req.query.return_to === 'string' ? req.query.return_to : undefined;
    const returnTo = rawReturnTo && rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//')
      ? rawReturnTo
      : undefined;
    req.session.driveOauthState = { state, returnTo };
    req.session.save((err) => {
      if (err) return next(err);
      res.redirect(buildDriveConsentUrl(state));
    });
  } catch (e) {
    next(e);
  }
});

integrationsRouter.get('/drive/callback', async (req, res, next) => {
  // Return to where the user was (defaults to /media), with `?drive=...`
  // appended — preserving any existing query string on returnTo.
  const back = (q: string, returnTo?: string) => {
    const base = `${env.WEB_ORIGIN}${returnTo ?? '/media'}`;
    const sep = base.includes('?') ? '&' : '?';
    res.redirect(`${base}${sep}drive=${encodeURIComponent(q)}`);
  };
  try {
    const me = req.session.user;
    const stored = req.session.driveOauthState;
    const returnTo = stored?.returnTo;
    if (!me) return back('error', returnTo);
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !state || !stored || state !== stored.state) return back('bad_state', returnTo);
    delete req.session.driveOauthState;
    const tokens = await exchangeDriveCode(code);
    await saveDriveToken(me.userId, tokens);
    await ensureSharedFolder();
    // Keep Integrations tab consistent with the token-backed Drive status.
    await connect('drive', { account: 'connected' }, me.userId);
    return back('connected', returnTo);
  } catch {
    return back('error', req.session.driveOauthState?.returnTo);
  }
});

integrationsRouter.post('/drive/disconnect', driveAccess, async (req, res, next) => {
  try {
    const me = req.session.user!;
    await disconnect('drive', me.userId);
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

integrationsRouter.get('/drive/file/:id/content', driveAccess, async (req, res, next) => {
  try {
    const id = req.params.id!;
    const meta = await getFileMeta(id);
    const stream = await downloadFile(id);
    res.setHeader('Content-Type', meta.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cache-Control', 'private, max-age=60');
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

const RenameDriveFileSchema = z.object({ name: z.string().trim().min(1).max(240) });
integrationsRouter.patch(
  '/drive/file/:id',
  requirePermission('media.manage'),
  validate(RenameDriveFileSchema),
  async (req, res, next) => {
    try {
      const { name } = getValidated<typeof RenameDriveFileSchema._type>(req);
      const entry = await renameEntry(req.params.id!, name);
      res.json(entry);
    } catch (e) {
      next(e);
    }
  },
);

// Reconcile client/project rows against the Drive folder tree. Clears
// dangling pointers, links rows that have a matching folder available,
// flags duplicates + orphans for admin review. Idempotent — safe to
// re-run. Gated on `integrations.manage` since it can modify
// `drive_folder_id` pointers across the workspace.
integrationsRouter.post('/drive/reconcile', requirePermission('integrations.manage'), async (_req, res, next) => {
  try {
    res.json(await reconcileFolders());
  } catch (e) {
    next(e);
  }
});

// ---- Gmail (per-user OAuth for transactional sends) ----
//
// Unlike Drive (workspace-wide single connection), Gmail is per-user — each
// teammate connects their own mailbox and any inviter sends from their own
// account. No `integrations.manage` gate; any signed-in user can connect or
// disconnect their own Gmail.

integrationsRouter.get('/gmail/status', async (req, res, next) => {
  try {
    const me = req.session.user!;
    res.json(await getGmailStatusForUser(me.userId));
  } catch (e) {
    next(e);
  }
});

integrationsRouter.get('/gmail/connect', async (req, res, next) => {
  try {
    if (!gmailConfigured()) {
      res.status(404).json({ error: 'gmail_oauth_not_configured' });
      return;
    }
    const state = randomBytes(16).toString('hex');
    // Carry an optional return_to so the just-in-time invite flow can
    // bounce the user straight back to where they triggered the modal.
    // Only allow same-origin path-only returns (no scheme, no `//host`) to
    // avoid open-redirect abuse.
    const rawReturnTo = typeof req.query.return_to === 'string' ? req.query.return_to : undefined;
    const returnTo = rawReturnTo && rawReturnTo.startsWith('/') && !rawReturnTo.startsWith('//')
      ? rawReturnTo
      : undefined;
    req.session.gmailOauthState = { state, returnTo };
    req.session.save((err) => {
      if (err) return next(err);
      res.redirect(buildGmailConsentUrl(state));
    });
  } catch (e) {
    next(e);
  }
});

integrationsRouter.get('/gmail/callback', async (req, res) => {
  // Redirect back to where the user was, with `?gmail=connected|bad_state|error`
  // appended (correctly preserving any existing query string in returnTo).
  const back = (q: string, returnTo?: string) => {
    const base = `${env.WEB_ORIGIN}${returnTo ?? '/admin?tab=integrations'}`;
    const sep = base.includes('?') ? '&' : '?';
    res.redirect(`${base}${sep}gmail=${encodeURIComponent(q)}`);
  };
  try {
    const me = req.session.user;
    const stored = req.session.gmailOauthState;
    const returnTo = stored?.returnTo;
    if (!me) return back('error', returnTo);
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !state || !stored || state !== stored.state) return back('bad_state', returnTo);
    delete req.session.gmailOauthState;
    const tokens = await exchangeGmailCode(code);
    await saveGmailToken(me.userId, tokens);
    return back('connected', returnTo);
  } catch {
    return back('error', req.session.gmailOauthState?.returnTo);
  }
});

integrationsRouter.post('/gmail/disconnect', async (req, res, next) => {
  try {
    const me = req.session.user!;
    await disconnectGmail(me.userId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// Returns the slim user records of every teammate currently holding a Gmail
// OAuth token. Drives the "System sender" dropdown in Settings, so it's
// gated to whoever can edit workspace settings (groups.manage — same gate
// PATCH /settings already uses).
integrationsRouter.get(
  '/gmail/connected-users',
  requirePermission('groups.manage'),
  async (_req, res, next) => {
    try {
      const [connectedIds, allUsers] = await Promise.all([
        listGmailConnectedUserIds(),
        listUsers(),
      ]);
      const set = new Set(connectedIds);
      const out = allUsers
        .filter((u) => set.has(u.id))
        .map((u) => ({ id: u.id, name: u.name, email: u.email, color: u.color }));
      res.json(out);
    } catch (e) {
      next(e);
    }
  },
);
