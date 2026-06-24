import { createServer } from 'node:http';
import { env } from './env.js';
import { buildApp } from './app.js';
import { initIO } from './realtime/io.js';
import { startPayPeriodSweep } from './jobs/payPeriodSweep.js';

// Standalone server (local dev / single-container self-host): the same Express
// app as the Netlify Function, plus an http.Server for Socket.IO and the
// in-process pay-period cron. On Netlify the function serves /api and these
// transport concerns don't apply (realtime → Supabase Realtime; cron →
// scheduled function — both later phases).
const app = buildApp();
const httpServer = createServer(app);
initIO(httpServer);

httpServer.listen(env.API_PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[api] listening on :${env.API_PORT}  (origin=${env.WEB_ORIGIN})`);
});

startPayPeriodSweep();

const shutdown = (signal: string) => {
  // eslint-disable-next-line no-console
  console.log(`[api] received ${signal}, shutting down`);
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
