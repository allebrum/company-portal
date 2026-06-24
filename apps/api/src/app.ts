import express, { type Express } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import pinoHttp from 'pino-http';
import { env, isProd } from './env.js';
import { supabaseAuth } from './auth/supabaseAuth.js';
import { apiRouter } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';

/**
 * Build the Express app (middleware + routes + error handler) with NO transport
 * concerns — no HTTP server, no cron. The standalone server (index.ts) wraps
 * this with an http.Server; the Netlify Function (netlify/functions/api.ts)
 * wraps it with serverless-http. Realtime is Supabase Realtime Broadcast
 * (emit.ts), so there's no Socket.IO endpoint either way.
 */
export function buildApp(): Express {
  const app = express();
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(compression());
  app.use(
    express.json({
      limit: '1mb',
      // Stash the raw body so the provisioning webhook can verify its HMAC over
      // the exact bytes.
      verify: (req, _res, buf) => {
        (req as unknown as { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.use(cookieParser());
  // Stateless auth: verify the Supabase JWT (Bearer) and populate req.session.user.
  app.use(supabaseAuth);
  app.use(
    pinoHttp({
      transport: isProd ? undefined : { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
    }),
  );

  app.use('/api', apiRouter);

  if (env.SERVE_WEB) {
    // Single-process self-host: also serve the pre-built static web export so
    // one origin serves the whole product. (On Netlify the web is served by the
    // CDN and only /api/* is routed to this function, so SERVE_WEB stays off.)
    const webDir =
      env.WEB_DIST_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/out');
    const webRoot = path.resolve(webDir);
    app.use(express.static(webRoot, { index: false }));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
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
      res.json({ name: 'modernzen-api', status: 'ok' });
    });
  }

  app.use(errorHandler);
  return app;
}
