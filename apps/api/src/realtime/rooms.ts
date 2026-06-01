// Hoppa: org broadcasts are now per-tenant. ORG_ROOM stays as a Phase-1
// compatibility room (sockets still join it, emit.toOrg falls back to it when
// no tenant context is available) so single-tenant behavior is preserved;
// Phase 2 drops it once every emit derives a tenant.
export const ORG_ROOM = 'org:allebrum';
export const APPROVERS_ROOM = 'role:approvers';

export const roomForUser = (userId: string) => `user:${userId}`;
/** Per-tenant broadcast room — `emit.toOrg` targets this when in a tenant context. */
export const roomForTenant = (tenantId: string) => `tenant:${tenantId}`;
