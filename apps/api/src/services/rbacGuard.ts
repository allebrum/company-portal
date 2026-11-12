import { OWNER_ONLY_PERMISSIONS } from '@allebrum/shared';

/**
 * Pure helpers for the Owner-only permission guard in services/rbac.ts (kept
 * dependency-free so they're unit-testable without DB/Redis).
 */

/** Permissions only an Owner (holder of `groups.manage`) may hand out. */
export const SENSITIVE_PERMISSIONS: ReadonlySet<string> = new Set<string>([...OWNER_ONLY_PERMISSIONS, 'groups.manage']);

/** Pure: does adding/removing these groups change who holds a sensitive permission? */
export function groupChangeIsSensitive(
  before: readonly string[],
  after: readonly string[],
  permsByGroup: ReadonlyMap<string, readonly string[]>,
): boolean {
  const b = new Set(before);
  const a = new Set(after);
  const changed = [...before.filter((g) => !a.has(g)), ...after.filter((g) => !b.has(g))];
  return changed.some((g) => (permsByGroup.get(g) ?? []).some((p) => SENSITIVE_PERMISSIONS.has(p)));
}

/** Pure: does replacing the override set change any sensitive permission override? */
export function overrideChangeIsSensitive(
  before: readonly { permission: string; effect: string }[],
  after: readonly { permission: string; effect: string }[],
): boolean {
  const key = (o: { permission: string; effect: string }) => `${o.permission}:${o.effect}`;
  const sb = new Set(before.filter((o) => SENSITIVE_PERMISSIONS.has(o.permission)).map(key));
  const sa = new Set(after.filter((o) => SENSITIVE_PERMISSIONS.has(o.permission)).map(key));
  if (sb.size !== sa.size) return true;
  for (const k of sb) if (!sa.has(k)) return true;
  return false;
}

