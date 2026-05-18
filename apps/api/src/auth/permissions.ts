import type { Request, Response, NextFunction } from 'express';
import { eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { userGroups, groupPermissions, userPermissionOverrides } from '../db/schema.js';
import type { Permission } from '@allebrum/shared';

/**
 * Effective permissions = union of all permissions from every group the user
 * belongs to, then apply per-user overrides (grant adds, deny removes).
 */
export async function getEffectivePermissions(userId: string): Promise<Set<string>> {
  const memberships = await db
    .select({ groupId: userGroups.groupId })
    .from(userGroups)
    .where(eq(userGroups.userId, userId));
  const groupIds = memberships.map((m) => m.groupId);

  const set = new Set<string>();
  if (groupIds.length > 0) {
    const gp = await db
      .select({ permissionKey: groupPermissions.permissionKey })
      .from(groupPermissions)
      .where(inArray(groupPermissions.groupId, groupIds));
    for (const r of gp) set.add(r.permissionKey);
  }

  const overrides = await db
    .select({ permissionKey: userPermissionOverrides.permissionKey, effect: userPermissionOverrides.effect })
    .from(userPermissionOverrides)
    .where(eq(userPermissionOverrides.userId, userId));
  for (const o of overrides) {
    if (o.effect === 'grant') set.add(o.permissionKey);
    else set.delete(o.permissionKey);
  }
  return set;
}

type ReqWithPerms = Request & { _perms?: Set<string> };

/** Loads (memoized on the request) the current user's effective permissions. */
export async function loadPermissions(req: Request): Promise<Set<string>> {
  const r = req as ReqWithPerms;
  if (r._perms) return r._perms;
  const userId = req.session?.user?.userId;
  const perms = userId ? await getEffectivePermissions(userId) : new Set<string>();
  r._perms = perms;
  return perms;
}

export async function userCan(req: Request, permission: Permission): Promise<boolean> {
  const perms = await loadPermissions(req);
  return perms.has(permission);
}

/** Middleware: require ALL listed permissions (mount after requireAuth). */
export function requirePermission(...needed: Permission[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.session?.user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      const perms = await loadPermissions(req);
      const missing = needed.filter((p) => !perms.has(p));
      if (missing.length > 0) {
        res.status(403).json({ error: 'forbidden', missing });
        return;
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Middleware: require ANY of the listed permissions (mount after requireAuth). */
export function requireAnyPermission(...needed: Permission[]) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.session?.user) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      const perms = await loadPermissions(req);
      if (!needed.some((p) => perms.has(p))) {
        res.status(403).json({ error: 'forbidden', anyOf: needed });
        return;
      }
      next();
    } catch (e) {
      next(e);
    }
  };
}
