// Hoppa: org broadcasts are now per-tenant. ORG_ROOM stays as a Phase-1
// compatibility room (sockets still join it, emit.toOrg falls back to it when
// no tenant context is available) so single-tenant behavior is preserved;
// Phase 2 drops it once every emit derives a tenant.
export const ORG_ROOM = 'org:allebrum';
export const APPROVERS_ROOM = 'role:approvers';

export const roomForUser = (userId: string) => `user:${userId}`;
/** Per-tenant broadcast room — `emit.toOrg` targets this when in a tenant context. */
export const roomForTenant = (tenantId: string) => `tenant:${tenantId}`;

/** Per-Space room inside a tenant — Notes editors watching that Space. The
 *  tenant id comes from the socket's session (never from the client), so a
 *  socket can only ever join rooms of its own workspace. */
export const roomForSpace = (tenantId: string, kind: 'client' | 'project', id: string) =>
  `tenant:${tenantId}:space:${kind}:${id}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Validates an untrusted 'space:watch' payload. */
export function parseSpaceRef(raw: unknown): { kind: 'client' | 'project'; id: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { kind, id } = raw as { kind?: unknown; id?: unknown };
  if (kind !== 'client' && kind !== 'project') return null;
  if (typeof id !== 'string' || !UUID_RE.test(id)) return null;
  return { kind, id };
}

/** Cap on Space rooms per socket so a client can't join unbounded rooms. */
export const MAX_SPACE_ROOMS_PER_SOCKET = 20;
