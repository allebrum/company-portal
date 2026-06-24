// Supabase Realtime topic names (formerly Socket.IO room names). Staff browsers
// subscribe to private channels tenant:{id} / user:{id} / approvers:{tenant};
// the server broadcasts to these topics via the Realtime REST endpoint (emit.ts).
// ORG_ROOM is only the no-tenant fallback for background jobs — no client
// subscribes to it.
export const ORG_ROOM = 'org:modernzen';
export const APPROVERS_ROOM = 'role:approvers';

export const roomForUser = (userId: string) => `user:${userId}`;
/** Per-tenant broadcast topic — `emit.toOrg` targets this when in a tenant context. */
export const roomForTenant = (tenantId: string) => `tenant:${tenantId}`;
/**
 * Per-tenant approvers topic. Tenant-scoped (unlike the legacy global
 * `role:approvers`) so entry-approval events never cross tenant boundaries.
 * Falls back to the global room only when there's no tenant context.
 */
export const roomForApprovers = (tenantId: string | null) =>
  tenantId ? `approvers:${tenantId}` : APPROVERS_ROOM;
