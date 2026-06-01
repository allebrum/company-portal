import type { Request, Response, NextFunction } from 'express';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import { userGroups, groupPermissions, userPermissionOverrides } from '../db/schema.js';
import type { Permission } from '@allebrum/shared';

/**
 * Effective permissions = union of all permissions from every group the user
 * belongs to IN THE GIVEN WORKSPACE, then apply that workspace's per-user
 * overrides (grant adds, deny removes).
 *
 * Hoppa: `tenantId` is passed explicitly (not from the AsyncLocalStorage
 * context) because this is called from places with no request context — the
 * socket-connect handler and the login flow before `session.user` is set. A
 * user's permissions in one workspace must never leak from their groups in
 * another, so all three queries filter on `tenant_id`.
 */
export async function getEffectivePermissions(userId: string, tenantId: string): Promise<Set<string>> {
  const memberships = await db
    .select({ groupId: userGroups.groupId })
    .from(userGroups)
    .where(and(eq(userGroups.userId, userId), eq(userGroups.tenantId, tenantId)));
  const groupIds = memberships.map((m) => m.groupId);

  const set = new Set<string>();
  if (groupIds.length > 0) {
    const gp = await db
      .select({ permissionKey: groupPermissions.permissionKey })
      .from(groupPermissions)
      .where(and(inArray(groupPermissions.groupId, groupIds), eq(groupPermissions.tenantId, tenantId)));
    for (const r of gp) set.add(r.permissionKey);
  }

  const overrides = await db
    .select({ permissionKey: userPermissionOverrides.permissionKey, effect: userPermissionOverrides.effect })
    .from(userPermissionOverrides)
    .where(and(eq(userPermissionOverrides.userId, userId), eq(userPermissionOverrides.tenantId, tenantId)));
  for (const o of overrides) {
    if (o.effect === 'grant') set.add(o.permissionKey);
    else set.delete(o.permissionKey);
  }
  return set;
}

type ReqWithPerms = Request & { _perms?: Set<string> };

/** Loads (memoized on the request) the current user's effective permissions in the active workspace. */
export async function loadPermissions(req: Request): Promise<Set<string>> {
  const r = req as ReqWithPerms;
  if (r._perms) return r._perms;
  const user = req.session?.user;
  const perms = user ? await getEffectivePermissions(user.userId, user.tenantId) : new Set<string>();
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
