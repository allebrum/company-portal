import express from 'express';
import { createServer } from 'node:http';
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

const app = express();
app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);
app.use(
  cors({
    origin: env.WEB_ORIGIN,
    credentials: true,
  }),
);
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(sessionMiddleware);
app.use(
  pinoHttp({
    transport: isProd ? undefined : { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
  }),
);

app.use('/api', apiRouter);

app.get('/', (_req, res) => {
  res.json({ name: 'allebrum-api', status: 'ok' });
});

app.use(errorHandler);

const httpServer = createServer(app);
initIO(httpServer, sessionMiddleware);

httpServer.listen(env.API_PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${env.API_PORT}  (origin=${env.WEB_ORIGIN})`);
});

const shutdown = (signal: string) => {
  // eslint-disable-next-line no-console
  console.log(`[api] received ${signal}, shutting down`);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
