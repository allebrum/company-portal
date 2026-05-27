import { Router } from 'express';
import multer from 'multer';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAnyPermission } from '../auth/permissions.js';
import { uploadSpaceFile, type SpaceScopeKind } from '../services/spaceFiles.js';

// Same 100 MB cap as the generic Drive upload route.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

// Uploading IS a media action — gate on the same permission that protects
// the generic Drive upload, NOT on `clients.manage`. The whole point of
// this route is to stop admins-with-media-but-not-clients from getting
// silent half-writes (Drive upload succeeds, spaceFiles 403s).
const uploadAccess = requireAnyPermission('media.manage', 'integrations.manage');

export const spacesRouter = Router();
spacesRouter.use(requireAuth);

spacesRouter.post(
  '/:scopeKind/:scopeId/files',
  uploadAccess,
  upload.single('file'),
  async (req, res, next) => {
    try {
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
    } catch (e) {
      next(e);
    }
  },
);
