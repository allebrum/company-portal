import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from '../env.js';
import { ORG_ROOM, APPROVERS_ROOM, roomForUser, roomForTenant } from './rooms.js';
import { getEffectivePermissions } from '../auth/permissions.js';
import { resolveAuth } from '../auth/supabaseAuth.js';
import type { ServerToClientEvents, ClientToServerEvents } from '@modernzen/shared';

let _io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;

export function getIO(): Server<ClientToServerEvents, ServerToClientEvents> {
  if (!_io) throw new Error('Socket.IO not initialized');
  return _io;
}

/**
 * Non-throwing accessor: returns the Socket.IO server, or null when it was
 * never initialized. The Netlify Function entrypoint (buildApp) deliberately
 * doesn't start Socket.IO, so realtime emits must degrade to a no-op there
 * rather than crash the request. See emit.ts. Realtime is restored properly by
 * the Supabase Realtime phase.
 */
export function getIOOrNull(): Server<ClientToServerEvents, ServerToClientEvents> | null {
  return _io;
}

// NOTE: this stays on Socket.IO's default in-memory adapter (no Redis) during
// the migration. Realtime is replaced by Supabase Realtime in a later phase;
// until then this serves a single API instance. Auth is the Supabase JWT,
// passed by the client via `io(url, { auth: { token, tenantId } })`.
export function initIO(httpServer: HttpServer) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: env.WEB_ORIGIN, credentials: true },
    transports: ['websocket', 'polling'],
  });

  io.use((socket, next) => {
    const auth = (socket.handshake.auth ?? {}) as { token?: string; tenantId?: string };
    void resolveAuth(auth.token, auth.tenantId)
      .then((user) => {
        if (!user) return next(new Error('unauthorized'));
        socket.data.user = user;
        next();
      })
      .catch(() => next(new Error('unauthorized')));
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as { userId: string; tenantId?: string } | undefined;
    if (!user) {
      socket.disconnect(true);
      return;
    }
    if (user.tenantId) socket.join(roomForTenant(user.tenantId));
    socket.join(ORG_ROOM);
    socket.join(roomForUser(user.userId));
    if (user.tenantId) {
      void getEffectivePermissions(user.userId, user.tenantId)
        .then((perms) => {
          if (perms.has('time_entry.approve')) socket.join(APPROVERS_ROOM);
        })
        .catch(() => undefined);
    }
  });

  _io = io;
  return io;
}
