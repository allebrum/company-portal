'use client';

import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@modernzen/shared';
import { API_URL, REALTIME_ENABLED } from './env';

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

/**
 * Returns the shared Socket.IO client, or `null` when realtime is disabled
 * (the serverless deploy has no Socket.IO server — see env.REALTIME_ENABLED).
 * Callers must handle null and fall back to query refetching.
 */
export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> | null {
  if (!REALTIME_ENABLED) return null;
  if (!socket) {
    socket = io(API_URL, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
