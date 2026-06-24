// Netlify Function: the Express API as a serverless handler. Same app as the
// standalone server (apps/api/src/app.ts → built to dist/app.js); only the
// transport differs. The `/api/*` redirect in netlify.toml routes here.
//
// (Socket.IO realtime is NOT served here — serverless can't hold WebSocket
// connections; realtime moves to Supabase Realtime in a later phase. The
// in-process pay-period cron likewise becomes a scheduled function.)
import serverless from 'serverless-http';
// eslint-disable-next-line import/no-relative-packages
import { buildApp } from '../../apps/api/dist/app.js';

const inner = serverless(buildApp());

// Normalize the path to the Express mount (`/api/...`) regardless of whether
// Netlify presents the original request path or the function-prefixed one.
export const handler = (event: Record<string, unknown>, context: unknown) => {
  let p = (event.path as string) || '/';
  p = p.replace(/^\/\.netlify\/functions\/api/, '');
  if (!p.startsWith('/api')) p = '/api' + (p === '/' ? '' : p);
  event.path = p;
  return (inner as (e: unknown, c: unknown) => unknown)(event, context);
};
