import { Router, type Response } from 'express';
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
import {
  AppendSpaceBlocksSchema,
  UpdateSpaceBlockSchema,
  type AppendSpaceBlocksInput,
  type UpdateSpaceBlockInput,
} from '@allebrum/shared';
import { appendSpaceBlocks, getSpaceBlocks, isUuid, mutateSpaceBlock, parseSpaceKind } from '../services/spaceBlocks.js';

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

// ---- Notes blocks (read, append, edit/delete one block) ---------------
//
// Used by personal access tokens (docs/BOT_API.md) but also session-usable.
// Same access rule as the Notes PATCH on clients/projects: any authenticated
// teammate in the workspace. Append never rewrites existing blocks; the
// per-block PATCH/DELETE touch only the addressed block (CAS on updated_at).
// Reordering / bulk rewrites go through PATCH /clients|projects/:id
// { spaceBlocks } with x-expected-updated-at.

spacesRouter.get('/:scopeKind/:scopeId/blocks', async (req, res, next) => {
  try {
    const kind = parseSpaceKind(req.params.scopeKind);
    if (!kind) {
      res.status(400).json({ error: 'invalid_scope_kind' });
      return;
    }
    if (!isUuid(req.params.scopeId)) {
      res.status(404).json({ error: `${kind}_not_found` });
      return;
    }
    await withRequestTenant(req, async () => {
      res.json(await getSpaceBlocks(kind, req.params.scopeId!));
    });
  } catch (e) {
    next(e);
  }
});

spacesRouter.post('/:scopeKind/:scopeId/blocks', validate(AppendSpaceBlocksSchema), async (req, res, next) => {
  try {
    const kind = parseSpaceKind(req.params.scopeKind);
    if (!kind) {
      res.status(400).json({ error: 'invalid_scope_kind' });
      return;
    }
    if (!isUuid(req.params.scopeId)) {
      res.status(404).json({ error: `${kind}_not_found` });
      return;
    }
    const input = getValidated<AppendSpaceBlocksInput>(req);
    await withRequestTenant(req, async () => {
      const out = await appendSpaceBlocks(kind, req.params.scopeId!, input.blocks, req.session.user!.userId);
      res.status(201).json(out);
    });
  } catch (e) {
    next(e);
  }
});

const BLOCK_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

function blockTarget(params: Record<string, string | undefined>, res: Response) {
  const kind = parseSpaceKind(params.scopeKind);
  if (!kind) {
    res.status(400).json({ error: 'invalid_scope_kind' });
    return null;
  }
  if (!isUuid(params.scopeId)) {
    res.status(404).json({ error: `${kind}_not_found` });
    return null;
  }
  if (!params.blockId || !BLOCK_ID_RE.test(params.blockId)) {
    res.status(404).json({ error: 'block_not_found' });
    return null;
  }
  return { kind, scopeId: params.scopeId, blockId: params.blockId };
}

spacesRouter.patch('/:scopeKind/:scopeId/blocks/:blockId', validate(UpdateSpaceBlockSchema), async (req, res, next) => {
  try {
    const t = blockTarget(req.params, res);
    if (!t) return;
    const patch = getValidated<UpdateSpaceBlockInput>(req);
    await withRequestTenant(req, async () => {
      res.json(await mutateSpaceBlock(t.kind, t.scopeId, t.blockId, { kind: 'update', patch }, req.session.user!.userId));
    });
  } catch (e) {
    next(e);
  }
});

spacesRouter.delete('/:scopeKind/:scopeId/blocks/:blockId', async (req, res, next) => {
  try {
    const t = blockTarget(req.params, res);
    if (!t) return;
    await withRequestTenant(req, async () => {
      res.json(await mutateSpaceBlock(t.kind, t.scopeId, t.blockId, { kind: 'delete' }, req.session.user!.userId));
    });
  } catch (e) {
    next(e);
  }
});
