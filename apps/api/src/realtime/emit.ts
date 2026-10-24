import { getIO } from './io.js';
import { ORG_ROOM, APPROVERS_ROOM, roomForUser, roomForTenant, roomForSpace } from './rooms.js';
import { currentTenantIdOrNull } from '../tenancy/context.js';
import { EV, type EventName, type SpaceBlocksUpdatedPayload } from '@allebrum/shared';
import { redactSecrets } from '../lib/redact.js';

/** Every socket payload passes through the same secret filter as res.json. */
const safe = (payload: unknown): any => redactSecrets(payload);

export const emit = {
  // Hoppa: "org" broadcasts are tenant-scoped. We derive the tenant from the
  // request's AsyncLocalStorage context so callers don't change. When there's
  // no context (background jobs), fall back to ORG_ROOM (single-tenant safe).
  toOrg(event: EventName, payload: unknown): void {
    const tenantId = currentTenantIdOrNull();
    const room = tenantId ? roomForTenant(tenantId) : ORG_ROOM;
    getIO().to(room).emit(event as any, safe(payload));
  },
  /** Explicit-tenant variant for emits outside a request context. */
  toTenant(tenantId: string, event: EventName, payload: unknown): void {
    getIO().to(roomForTenant(tenantId)).emit(event as any, safe(payload));
  },
  /** Notes change notice to editors watching this Space in the current
   *  tenant. No tenant context → no-op (Space rooms are tenant-scoped). */
  spaceBlocksUpdated(payload: SpaceBlocksUpdatedPayload): void {
    const tenantId = currentTenantIdOrNull();
    if (!tenantId) return;
    getIO().to(roomForSpace(tenantId, payload.kind, payload.id)).emit(EV.SPACE_BLOCKS_UPDATED, safe(payload));
  },
  toUser(userId: string, event: EventName, payload: unknown): void {
    getIO().to(roomForUser(userId)).emit(event as any, safe(payload));
  },
  toApprovers(event: EventName, payload: unknown): void {
    getIO().to(APPROVERS_ROOM).emit(event as any, safe(payload));
  },
  toUsers(userIds: string[], event: EventName, payload: unknown): void {
    const rooms = userIds.map(roomForUser);
    if (rooms.length === 0) return;
    getIO().to(rooms).emit(event as any, safe(payload));
  },
  toUserAndApprovers(userId: string, event: EventName, payload: unknown): void {
    getIO().to([roomForUser(userId), APPROVERS_ROOM]).emit(event as any, safe(payload));
  },
};
