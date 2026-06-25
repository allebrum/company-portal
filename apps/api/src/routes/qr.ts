import { Router } from 'express';
import QRCode from 'qrcode';
import { CreateQrSchema, UpdateQrSchema } from '@allebrum/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validate, getValidated } from '../middleware/validate.js';
import { env } from '../env.js';
import * as qrSvc from '../services/qrCodes.js';

/**
 * F24 — Tools / QR Code Generator routes.
 *
 *   qrRouter         (mounted at /api/qr, all behind requireAuth)
 *   qrPublicRouter   (mounted at /api/q, NO auth — this is the scan
 *                     endpoint the QR image actually points at)
 */

export const qrRouter = Router();
qrRouter.use(requireAuth);

qrRouter.get('/', async (req, res, next) => {
  try {
    const me = req.session.user!;
    const clientId = typeof req.query.clientId === 'string' && req.query.clientId ? req.query.clientId : undefined;
    const projectId = typeof req.query.projectId === 'string' && req.query.projectId ? req.query.projectId : undefined;
    res.json(await qrSvc.listVisible({ viewerId: me.userId, clientId, projectId }));
  } catch (e) {
    next(e);
  }
});

qrRouter.post('/', validate(CreateQrSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const input = getValidated<typeof CreateQrSchema._type>(req);
    const row = await qrSvc.create({ ownerId: me.userId, input });
    res.status(201).json(row);
  } catch (e) {
    next(e);
  }
});

qrRouter.patch('/:id', validate(UpdateQrSchema), async (req, res, next) => {
  try {
    const me = req.session.user!;
    const patch = getValidated<typeof UpdateQrSchema._type>(req);
    const row = await qrSvc.update({ id: req.params.id!, ownerId: me.userId, patch });
    res.json(row);
  } catch (e) {
    next(e);
  }
});

qrRouter.delete('/:id', async (req, res, next) => {
  try {
    const me = req.session.user!;
    await qrSvc.softDelete(req.params.id!, me.userId);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

qrRouter.get('/:id/scans', async (req, res, next) => {
  try {
    const me = req.session.user!;
    res.json(await qrSvc.summaryFor({ id: req.params.id!, viewerId: me.userId }));
  } catch (e) {
    next(e);
  }
});

qrRouter.get('/:id/scans.csv', async (req, res, next) => {
  try {
    const me = req.session.user!;
    const id = req.params.id!;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="qr-${id}-scans.csv"`);
    for await (const chunk of qrSvc.scansCsvStream({ id, viewerId: me.userId })) {
      res.write(chunk);
    }
    res.end();
  } catch (e) {
    next(e);
  }
});

/**
 * Server-rendered PNG download. Uses the existing `qrcode` package
 * (no new dep). The row's foreground / background colors and error
 * correction level are honored; logo overlay is NOT applied server-side
 * — the web UI uses canvas compositing for that path so we don't pull
 * the heavy `canvas` npm dep.
 */
qrRouter.get('/:id/image.png', async (req, res, next) => {
  try {
    const me = req.session.user!;
    const code = await qrSvc.getForViewer(req.params.id!, me.userId);
    if (!code) {
      res.status(404).json({ error: 'qr_not_found' });
      return;
    }
    const trackUrl = `${env.WEB_ORIGIN}/api/q/${code.shortCode}`;
    const buf = await QRCode.toBuffer(trackUrl, {
      type: 'png',
      width: 512,
      margin: 1,
      errorCorrectionLevel: code.errorCorrection as 'L' | 'M' | 'Q' | 'H',
      color: {
        dark: code.foregroundColor,
        light: code.backgroundColor,
      },
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Content-Disposition', `attachment; filename="qr-${code.label || code.shortCode}.png"`);
    res.send(buf);
  } catch (e) {
    next(e);
  }
});

// ---------- Public scan endpoint --------------------------------------

export const qrPublicRouter = Router();

/**
 * Public scan + redirect. Rate-limited per IP at 120/min so a bot loop
 * can't balloon the `qr_scans` table. On unknown / archived short codes
 * we return 404 instead of redirecting blind.
 */
qrPublicRouter.get(
  '/:shortCode',
  rateLimit({ key: 'qr-shortlink', max: 120, windowSec: 60 }),
  async (req, res, next) => {
    try {
      // express's req.ip respects trust-proxy when configured; falls back
      // to the socket remote address.
      const ip = (req.ip ?? req.socket.remoteAddress ?? null) || null;
      const userAgent = req.headers['user-agent'] ?? null;
      const referer = (req.headers.referer ?? req.headers.referrer ?? null) as string | null;
      const result = await qrSvc.recordScan({
        shortCode: req.params.shortCode!,
        ip,
        userAgent,
        referer,
      });
      if (!result) {
        res.status(404).send('Not found');
        return;
      }
      res.redirect(302, result.targetUrl);
    } catch (e) {
      next(e);
    }
  },
);
