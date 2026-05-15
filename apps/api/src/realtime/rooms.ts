// Single-tenant: org is constant. Swap for session-derived value when multi-tenancy lands.
export const ORG_ROOM = 'org:allebrum';
export const APPROVERS_ROOM = 'role:approvers';

export const roomForUser = (userId: string) => `user:${userId}`;

import type { Role } from '@allebrum/shared';

export function isApprover(role: Role): boolean {
  return role === 'owner' || role === 'admin' || role === 'bookkeeper';
}
