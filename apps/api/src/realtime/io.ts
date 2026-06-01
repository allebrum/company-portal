import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { RequestHandler } from 'express';
import { redisPub, redisSub } from '../redis.js';
import { env } from '../env.js';
import { ORG_ROOM, APPROVERS_ROOM, roomForUser, roomForTenant } from './rooms.js';
import { getEffectivePermissions } from '../auth/permissions.js';
import type { ServerToClientEvents, ClientToServerEvents } from '@allebrum/shared';

let _io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;

export function getIO(): Server<ClientToServerEvents, ServerToClientEvents> {
  if (!_io) throw new Error('Socket.IO not initialized');
  return _io;
}

export function initIO(httpServer: HttpServer, sessionMiddleware: RequestHandler) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: env.WEB_ORIGIN, credentials: true },
    transports: ['websocket', 'polling'],
  });

  io.adapter(createAdapter(redisPub, redisSub));

  // Share the express-session middleware so socket.request.session works.
  // The engine.use signature differs from RequestHandler types — cast.
  io.engine.use(sessionMiddleware as unknown as (req: unknown, res: unknown, next: () => void) => void);

  io.use((socket, next) => {
    const req = socket.request as unknown as { session?: { user?: { userId: string; tenantId?: string } } };
    const user = req.session?.user;
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as { userId: string; tenantId?: string } | undefined;
    if (!user) {
      socket.disconnect(true);
      return;
    }
    // Hoppa: join the user's workspace room so per-tenant broadcasts reach
    // only that workspace. Keep ORG_ROOM during Phase 1 so emits that fall
    // back to it (no tenant context) still deliver in the single-tenant case.
    if (user.tenantId) socket.join(roomForTenant(user.tenantId));
    socket.join(ORG_ROOM);
    socket.join(roomForUser(user.userId));
    void getEffectivePermissions(user.userId)
      .then((perms) => {
        if (perms.has('time_entry.approve')) socket.join(APPROVERS_ROOM);
      })
      .catch(() => undefined);
  });

  _io = io;
  return io;
}
