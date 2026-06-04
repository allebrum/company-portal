import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAnyPermission } from '../auth/permissions.js';
import {
  uploadSpaceFile,
  renameSpaceFile,
  refreshSpaceFileNamesFromDrive,
  type SpaceScopeKind,
} from '../services/spaceFiles.js';
import { validate, getValidated } from '../middleware/validate.js';
import { withTenant } from '../tenancy/context.js';

// Same 100 MB cap as the generic Drive upload route.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// Uploading IS a media action — gate on the same permission that protects
// the generic Drive upload, NOT on `clients.manage`. The whole point of
// this route is to stop admins-with-media-but-not-clients from getting
// silent half-writes (Drive upload succeeds, spaceFiles 403s).
const uploadAccess = requireAnyPermission('media.manage', 'integrations.manage');

export const spacesRouter = Router();
spacesRouter.use(requireAuth);

function withRequestTenant<T>(req: Express.Request, fn: () => Promise<T>): Promise<T> {
  const tenantId = req.session.user?.tenantId;
  if (!tenantId) {
    throw new Error('authenticated request is missing tenantId');
  }
  return withTenant(tenantId, fn);
}

const RenameSpaceFileSchema = z.object({
  title: z.string().trim().min(1).max(240),
  renameInDrive: z.boolean().optional(),
});

spacesRouter.post(
  '/:scopeKind/:scopeId/files',
  uploadAccess,
  upload.single('file'),
  async (req, res, next) => {
    try {
      await withRequestTenant(req, async () => {
        const me = req.session.user!;
        const scopeKind = req.params.scopeKind as SpaceScopeKind;
        const scopeId = req.params.scopeId!;
        if (scopeKind !== 'client' && scopeKind !== 'project') {
          res.status(400).json({ error: 'invalid_scope_kind' });
          return;
        }
        const file = (req as unknown as { file?: Express.Multer.File }).file;
        if (!file) {
          res.status(400).json({ error: 'file_required' });
          return;
        }
        const result = await uploadSpaceFile({
          scopeKind,
          scopeId,
          whoId: me.userId,
          filename: file.originalname,
          mimeType: file.mimetype,
          buffer: file.buffer,
        });
        res.status(201).json(result);
      });
    } catch (e) {
      next(e);
    }
  },
);

spacesRouter.patch(
  '/:scopeKind/:scopeId/files/:fileId',
  uploadAccess,
  validate(RenameSpaceFileSchema),
  async (req, res, next) => {
    try {
      await withRequestTenant(req, async () => {
        const me = req.session.user!;
        const scopeKind = req.params.scopeKind as SpaceScopeKind;
        const scopeId = req.params.scopeId!;
        const fileId = req.params.fileId!;
        if (scopeKind !== 'client' && scopeKind !== 'project') {
          res.status(400).json({ error: 'invalid_scope_kind' });
          return;
        }
        const input = getValidated<typeof RenameSpaceFileSchema._type>(req);
        const result = await renameSpaceFile({
          scopeKind,
          scopeId,
          fileId,
          title: input.title,
          renameInDrive: input.renameInDrive,
          whoId: me.userId,
        });
        res.json(result);
      });
    } catch (e) {
      next(e);
    }
  },
);

spacesRouter.post('/:scopeKind/:scopeId/files/refresh-drive-names', uploadAccess, async (req, res, next) => {
  try {
    await withRequestTenant(req, async () => {
      const me = req.session.user!;
      const scopeKind = req.params.scopeKind as SpaceScopeKind;
      const scopeId = req.params.scopeId!;
      if (scopeKind !== 'client' && scopeKind !== 'project') {
        res.status(400).json({ error: 'invalid_scope_kind' });
        return;
      }
      const out = await refreshSpaceFileNamesFromDrive({ scopeKind, scopeId, whoId: me.userId });
      res.json(out);
    });
  } catch (e) {
    next(e);
  }
});
