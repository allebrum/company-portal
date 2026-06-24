import { ORG_ROOM, roomForUser, roomForTenant, roomForApprovers } from './rooms.js';
import { currentTenantIdOrNull } from '../tenancy/context.js';
import { env } from '../env.js';
import type { EventName } from '@modernzen/shared';

/**
 * Realtime fan-out via Supabase Realtime Broadcast.
 *
 * The Express app runs in a short-lived Netlify Function, so we publish over
 * the stateless Broadcast REST endpoint with the service-role key (no websocket
 * to open/await/tear-down). Browsers subscribe to PRIVATE channels named by the
 * same topic helpers; RLS on `realtime.messages` (migration 0004) enforces that
 * a subscriber only receives its own user / tenant / approvers topics.
 *
 * Best-effort: when Supabase isn't configured (self-host without it), every
 * helper no-ops. Sends are fire-and-forget and never throw into the caller, so a
 * realtime hiccup can never fail the DB write that triggered it. Every emit.*
 * call site is unchanged from the Socket.IO era.
 */
type BroadcastMsg = { topic: string; event: string; payload: unknown };

function broadcastMany(messages: BroadcastMsg[]): void {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return; // realtime disabled
  if (messages.length === 0) return;
  const body = JSON.stringify({
    messages: messages.map((m) => ({ topic: m.topic, event: m.event, payload: m.payload, private: true })),
  });
  void fetch(`${env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
    body,
  }).catch(() => undefined);
}

function broadcast(topic: string, event: EventName, payload: unknown): void {
  broadcastMany([{ topic, event: event as string, payload }]);
}

export const emit = {
  // "org" broadcasts are tenant-scoped: derive the tenant from the request's
  // AsyncLocalStorage context. No context (background jobs) → ORG_ROOM fallback.
  toOrg(event: EventName, payload: unknown): void {
    const tenantId = currentTenantIdOrNull();
    broadcast(tenantId ? roomForTenant(tenantId) : ORG_ROOM, event, payload);
  },
  /** Explicit-tenant variant for emits outside a request context. */
  toTenant(tenantId: string, event: EventName, payload: unknown): void {
    broadcast(roomForTenant(tenantId), event, payload);
  },
  toUser(userId: string, event: EventName, payload: unknown): void {
    broadcast(roomForUser(userId), event, payload);
  },
  toApprovers(event: EventName, payload: unknown): void {
    broadcast(roomForApprovers(currentTenantIdOrNull()), event, payload);
  },
  toUsers(userIds: string[], event: EventName, payload: unknown): void {
    broadcastMany(userIds.map((id) => ({ topic: roomForUser(id), event: event as string, payload })));
  },
  toUserAndApprovers(userId: string, event: EventName, payload: unknown): void {
    broadcastMany([
      { topic: roomForUser(userId), event: event as string, payload },
      { topic: roomForApprovers(currentTenantIdOrNull()), event: event as string, payload },
    ]);
  },
};
