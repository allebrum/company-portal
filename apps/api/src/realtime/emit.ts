import { getIOOrNull } from './io.js';
import { ORG_ROOM, APPROVERS_ROOM, roomForUser, roomForTenant } from './rooms.js';
import { currentTenantIdOrNull } from '../tenancy/context.js';
import type { EventName } from '@modernzen/shared';

// Realtime is best-effort. When Socket.IO isn't running (the Netlify Function
// runtime — see io.ts/app.ts), every helper no-ops via `getIOOrNull()` instead
// of throwing, so write handlers that emit after a successful DB write don't
// 500. Local/self-host (index.ts calls initIO) still emits for real. Live
// updates in serverless are restored by the Supabase Realtime phase.
export const emit = {
  // Hoppa: "org" broadcasts are tenant-scoped. We derive the tenant from the
  // request's AsyncLocalStorage context so callers don't change. When there's
  // no context (background jobs), fall back to ORG_ROOM (single-tenant safe).
  toOrg(event: EventName, payload: unknown): void {
    const io = getIOOrNull();
    if (!io) return;
    const tenantId = currentTenantIdOrNull();
    const room = tenantId ? roomForTenant(tenantId) : ORG_ROOM;
    io.to(room).emit(event as any, payload as any);
  },
  /** Explicit-tenant variant for emits outside a request context. */
  toTenant(tenantId: string, event: EventName, payload: unknown): void {
    const io = getIOOrNull();
    if (!io) return;
    io.to(roomForTenant(tenantId)).emit(event as any, payload as any);
  },
  toUser(userId: string, event: EventName, payload: unknown): void {
    const io = getIOOrNull();
    if (!io) return;
    io.to(roomForUser(userId)).emit(event as any, payload as any);
  },
  toApprovers(event: EventName, payload: unknown): void {
    const io = getIOOrNull();
    if (!io) return;
    io.to(APPROVERS_ROOM).emit(event as any, payload as any);
  },
  toUsers(userIds: string[], event: EventName, payload: unknown): void {
    const io = getIOOrNull();
    if (!io) return;
    const rooms = userIds.map(roomForUser);
    if (rooms.length === 0) return;
    io.to(rooms).emit(event as any, payload as any);
  },
  toUserAndApprovers(userId: string, event: EventName, payload: unknown): void {
    const io = getIOOrNull();
    if (!io) return;
    io.to([roomForUser(userId), APPROVERS_ROOM]).emit(event as any, payload as any);
  },
};
