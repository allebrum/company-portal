import { getIO } from './io.js';
import { ORG_ROOM, APPROVERS_ROOM, roomForUser, roomForTenant } from './rooms.js';
import { currentTenantIdOrNull } from '../tenancy/context.js';
import type { EventName } from '@modernzen/shared';

export const emit = {
  // Hoppa: "org" broadcasts are tenant-scoped. We derive the tenant from the
  // request's AsyncLocalStorage context so callers don't change. When there's
  // no context (background jobs), fall back to ORG_ROOM (single-tenant safe).
  toOrg(event: EventName, payload: unknown): void {
    const tenantId = currentTenantIdOrNull();
    const room = tenantId ? roomForTenant(tenantId) : ORG_ROOM;
    getIO().to(room).emit(event as any, payload as any);
  },
  /** Explicit-tenant variant for emits outside a request context. */
  toTenant(tenantId: string, event: EventName, payload: unknown): void {
    getIO().to(roomForTenant(tenantId)).emit(event as any, payload as any);
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
