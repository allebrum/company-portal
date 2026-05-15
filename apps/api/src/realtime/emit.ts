import { getIO } from './io.js';
import { ORG_ROOM, APPROVERS_ROOM, roomForUser } from './rooms.js';
import type { EventName } from '@allebrum/shared';

export const emit = {
  toOrg(event: EventName, payload: unknown): void {
    getIO().to(ORG_ROOM).emit(event as any, payload as any);
  },
  toUser(userId: string, event: EventName, payload: unknown): void {
    getIO().to(roomForUser(userId)).emit(event as any, payload as any);
  },
  toApprovers(event: EventName, payload: unknown): void {
    getIO().to(APPROVERS_ROOM).emit(event as any, payload as any);
  },
  toUsers(userIds: string[], event: EventName, payload: unknown): void {
    const rooms = userIds.map(roomForUser);
    if (rooms.length === 0) return;
    getIO().to(rooms).emit(event as any, payload as any);
  },
  toUserAndApprovers(userId: string, event: EventName, payload: unknown): void {
    getIO().to([roomForUser(userId), APPROVERS_ROOM]).emit(event as any, payload as any);
  },
};
