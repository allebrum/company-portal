import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireAnyPermission, requirePermission } from '../auth/permissions.js';
import { validate, getValidated } from '../middleware/validate.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { env } from '../env.js';
import {
  createUploadQrSession,
  getUploadQrSession,
  listActiveUploadQrSessions,
  listUploadQrSessionFiles,
  revokeUploadQrSession,
  uploadViaQrSession,
  type UploadQrTarget,
} from '../services/uploadQr.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
const uploadAccess = requireAnyPermission('media.manage', 'integrations.manage');

const CreateUploadQrSessionSchema = z.object({
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('space'), scopeKind: z.enum(['client', 'project']), scopeId: z.string().min(1) }),
    z.object({ kind: z.literal('drive'), folderId: z.string().min(1) }),
    z.object({ kind: z.literal('todo'), todoId: z.string().min(1) }),
    z.object({ kind: z.literal('goal'), goalId: z.string().min(1) }),
  ]),
  label: z.string().max(200).optional(),
  expiresInHours: z.number().int().min(1).max(24 * 14).optional(),
});

export const uploadQrRouter = Router();

function normalizeOptionalText(value: unknown, maxLen: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

uploadQrRouter.get('/sessions', requireAuth, requirePermission('integrations.manage'), async (_req, res, next) => {
  try {
    const rows = await listActiveUploadQrSessions();
    const out = rows.map((row) => ({
      ...row,
      uploadUrl: `${env.WEB_ORIGIN.replace(/\/$/, '')}/upload/qr?token=${encodeURIComponent(row.token)}`,
    }));
    res.json(out);
  } catch (e) {
    next(e);
  }
});

uploadQrRouter.post('/sessions/:id/revoke', requireAuth, requirePermission('integrations.manage'), async (req, res, next) => {
  try {
    await revokeUploadQrSession(req.params.id!);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

uploadQrRouter.get('/sessions/:id/files', requireAuth, uploadAccess, async (req, res, next) => {
  try {
    const rows = await listUploadQrSessionFiles(req.params.id!);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

uploadQrRouter.post('/sessions', requireAuth, uploadAccess, validate(CreateUploadQrSessionSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const input = getValidated<typeof CreateUploadQrSessionSchema._type>(req);
    const hours = input.expiresInHours ?? 24;
    const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

    const row = await createUploadQrSession({
      createdBy: me.userId,
      target: input.target as UploadQrTarget,
      label: input.label,
      expiresAt,
    });

    const uploadUrl = `${env.WEB_ORIGIN.replace(/\/$/, '')}/upload/qr?token=${encodeURIComponent(row.token)}`;
    res.status(201).json({ id: row.id, token: row.token, uploadUrl, label: row.label, expiresAt: row.expiresAt });
  } catch (e) {
    next(e);
  }
});

uploadQrRouter.get('/:token', rateLimit({ key: 'upload-qr-meta', max: 120, windowSec: 60 }), async (req, res, next) => {
  try {
    const row = await getUploadQrSession(req.params.token!);
    res.json({
      token: row.token,
      label: row.label,
      expiresAt: row.expiresAt,
      uploadedCount: row.uploadedCount,
    });
  } catch (e) {
    next(e);
  }
});

uploadQrRouter.post(
  '/:token/files',
  rateLimit({ key: 'upload-qr-files', max: 60, windowSec: 60 }),
  upload.array('files', 20),
  async (req, res, next) => {
    try {
      const files = (req as unknown as { files?: Express.Multer.File[] }).files ?? [];
      if (files.length === 0) {
        res.status(400).json({ error: 'files_required' });
        return;
      }
      const body = req.body as Record<string, unknown>;
      const out = await uploadViaQrSession(req.params.token!, files, {
        uploadTitle: normalizeOptionalText(body.uploadTitle, 120),
        uploadNotes: normalizeOptionalText(body.uploadNotes, 400),
      });
      res.json(out);
    } catch (e) {
      next(e);
    }
  },
);
