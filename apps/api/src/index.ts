import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import pinoHttp from 'pino-http';
import { env, isProd } from './env.js';
import { sessionMiddleware } from './session.js';
import { apiRouter } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { initIO } from './realtime/io.js';
import { startPayPeriodSweep } from './jobs/payPeriodSweep.js';
import { startTimeReminderSweep } from './jobs/timeReminders.js';

const app = express();
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.use(
  cors((req, cb) => {
    const isPublicForms = req.path.startsWith('/api/f/');
    if (isPublicForms) {
      cb(null, {
        origin: true,
        credentials: false,
      });
      return;
    }
    cb(null, {
      origin: env.WEB_ORIGIN,
      credentials: true,
    });
  }),
);
app.use(compression());
app.use(
  express.json({
    limit: '1mb',
    // Hoppa: stash the raw body so the provisioning webhook can verify its
    // HMAC signature over the exact bytes the marketing site signed.
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);
app.use(cookieParser());
app.use(sessionMiddleware);
app.use(
  pinoHttp({
    transport: isProd ? undefined : { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
  }),
);

app.use('/api', apiRouter);

if (env.SERVE_WEB) {
  // Self-host single-container mode: serve the pre-built static web export so
  // one process serves the whole product on one origin (no CORS / cookie-domain
  // setup). The SaaS deploy leaves SERVE_WEB off — there the web is a separate
  // static site fronted by the platform.
  const webDir =
    env.WEB_DIST_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/out');
  const webRoot = path.resolve(webDir);
  app.use(express.static(webRoot, { index: false }));
  // Next static export emits <route>/index.html (trailingSlash:true). Resolve
  // any non-API GET to its index.html, falling back to the export's 404 page.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      next();
      return;
    }
    const rel = req.path === '/' ? 'index.html' : path.join(req.path, 'index.html');
    const abs = path.resolve(webRoot, '.' + path.sep + rel);
    if (!abs.startsWith(webRoot)) {
      res.status(404).end();
      return;
    }
    res.sendFile(abs, (err) => {
      if (err) res.status(404).sendFile(path.join(webRoot, '404.html'), () => res.end());
    });
  });
} else {
  app.get('/', (_req, res) => {
    res.json({ name: 'hoppa-api', status: 'ok' });
  });
}

app.use(errorHandler);

const httpServer = createServer(app);
initIO(httpServer, sessionMiddleware);

httpServer.listen(env.API_PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${env.API_PORT}  (origin=${env.WEB_ORIGIN})`);
});

// Keep every workspace's pay-period runway topped up without anyone having
// to visit the Approvals page (boot + every 12h; idempotent per tenant).
startPayPeriodSweep();

// Payroll reminder emails: on each workspace's processing day, nudge
// employees (morning) to submit time and approvers (end of day) to review it.
// Idempotent per (tenant, period, kind, local-day); honors per-workspace tz.
startTimeReminderSweep();

// Billing (Stripe + the recurring-charge cron) lives in the separate marketing
// service now; the portal only reads the tenant billing columns to gate.

const shutdown = (signal: string) => {
  // eslint-disable-next-line no-console
  console.log(`[api] received ${signal}, shutting down`);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
