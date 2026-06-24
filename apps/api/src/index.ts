import { createServer } from 'node:http';
import { env } from './env.js';
import { buildApp } from './app.js';
import { startPayPeriodSweep } from './jobs/payPeriodSweep.js';

// Standalone server (local dev / single-container self-host): the same Express
// app as the Netlify Function, plus the in-process pay-period cron. Realtime is
// now Supabase Realtime Broadcast (emit.ts publishes over REST), so there's no
// Socket.IO server to attach — both the function and this server fan out the
// same way. (Cron → a scheduled function is a later phase.)
const app = buildApp();
const httpServer = createServer(app);

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
