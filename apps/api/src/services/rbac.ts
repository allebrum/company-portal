import { eq, asc, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  permissions,
  groups,
  groupPermissions,
  userGroups,
  userPermissionOverrides,
  type Group,
} from '../db/schema.js';
import { tenantEq, stampTenant } from '../tenancy/scope.js';
import type {
  CreateGroupInput,
  UpdateGroupInput,
  Permission,
} from '@allebrum/shared';
import { emit } from '../realtime/emit.js';
import { EV } from '@allebrum/shared';
import { appendActivity } from './activity.js';
import { HttpError } from '../middleware/errorHandler.js';

export async function listPermissions() {
  return db.select().from(permissions).orderBy(asc(permissions.category), asc(permissions.key));
}

export type GroupWithPerms = Group & { permissions: string[] };

export async function listGroups(): Promise<GroupWithPerms[]> {
  const gs = await db.select().from(groups).where(tenantEq(groups.tenantId)).orderBy(asc(groups.name));
  const gp = await db.select().from(groupPermissions).where(tenantEq(groupPermissions.tenantId));
  const byGroup = new Map<string, string[]>();
  for (const r of gp) {
    const arr = byGroup.get(r.groupId) ?? [];
    arr.push(r.permissionKey);
    byGroup.set(r.groupId, arr);
  }
  return gs.map((g) => ({ ...g, permissions: byGroup.get(g.id) ?? [] }));
}

export async function createGroup(input: CreateGroupInput, whoId: string): Promise<Group> {
  const [row] = await db
    .insert(groups)
    .values(stampTenant({ name: input.name, description: input.description, require2fa: input.require2fa }))
    .returning();
  if (!row) throw new Error('group insert failed');
  emit.toOrg(EV.GROUP_UPDATED, { id: row.id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'group.create', target: `Group "${row.name}" created` });
  return row;
}

export async function updateGroup(id: string, patch: UpdateGroupInput, whoId: string): Promise<Group> {
  const upd: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) upd.name = patch.name;
  if (patch.description !== undefined) upd.description = patch.description;
  if (patch.require2fa !== undefined) upd.require2fa = patch.require2fa;
  const [row] = await db
    .update(groups)
    .set(upd)
    .where(and(eq(groups.id, id), tenantEq(groups.tenantId)))
    .returning();
  if (!row) throw new HttpError(404, 'group_not_found');
  emit.toOrg(EV.GROUP_UPDATED, { id: row.id, by: whoId, at: new Date().toISOString() });
  return row;
}

export async function deleteGroup(id: string, whoId: string): Promise<void> {
  const rows = await db.select().from(groups).where(and(eq(groups.id, id), tenantEq(groups.tenantId))).limit(1);
  const g = rows[0];
  if (!g) throw new HttpError(404, 'group_not_found');
  if (g.isSystem) throw new HttpError(400, 'cannot_delete_system_group');
  await db.delete(groups).where(and(eq(groups.id, id), tenantEq(groups.tenantId)));
  emit.toOrg(EV.GROUP_UPDATED, { id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'group.delete', target: `Group "${g.name}" deleted` });
}

export async function setGroupPermissions(
  groupId: string,
  perms: Permission[],
  whoId: string,
): Promise<void> {
  const rows = await db.select().from(groups).where(and(eq(groups.id, groupId), tenantEq(groups.tenantId))).limit(1);
  if (!rows[0]) throw new HttpError(404, 'group_not_found');
  await db.transaction(async (tx) => {
    await tx.delete(groupPermissions).where(and(eq(groupPermissions.groupId, groupId), tenantEq(groupPermissions.tenantId)));
    if (perms.length > 0) {
      await tx
        .insert(groupPermissions)
        .values(perms.map((p) => stampTenant({ groupId, permissionKey: p })));
    }
  });
  emit.toOrg(EV.GROUP_UPDATED, { id: groupId, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'group.permissions', target: `Permissions updated for a group` });
}

export async function getUserGroupIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ groupId: userGroups.groupId })
    .from(userGroups)
    .where(and(eq(userGroups.userId, userId), tenantEq(userGroups.tenantId)));
  return rows.map((r) => r.groupId);
}

export async function setUserGroups(userId: string, groupIds: string[], whoId: string): Promise<void> {
  await db.transaction(async (tx) => {
    // Only clear THIS workspace's memberships — the user's groups in other
    // workspaces are untouched.
    await tx.delete(userGroups).where(and(eq(userGroups.userId, userId), tenantEq(userGroups.tenantId)));
    if (groupIds.length > 0) {
      await tx.insert(userGroups).values(groupIds.map((groupId) => stampTenant({ userId, groupId })));
    }
  });
  emit.toOrg(EV.USER_UPDATED, { id: userId, by: whoId, at: new Date().toISOString() });
}

/**
 * F25: list the userIds currently in `groupId`. Used by the redesigned
 * GroupsTab to render the per-group Members section.
 */
export async function listGroupMembers(groupId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: userGroups.userId })
    .from(userGroups)
    .where(and(eq(userGroups.groupId, groupId), tenantEq(userGroups.tenantId)));
  return rows.map((r) => r.userId);
}

/**
 * F25: add a single user to a group. Idempotent — a duplicate `(userId,
 * groupId)` is a no-op via ON CONFLICT DO NOTHING. Emits USER_UPDATED so
 * permission rollups on the client refresh.
 */
export async function addUserToGroup(userId: string, groupId: string, whoId: string): Promise<void> {
  const g = await db.select().from(groups).where(and(eq(groups.id, groupId), tenantEq(groups.tenantId))).limit(1);
  if (!g[0]) throw new HttpError(404, 'group_not_found');
  await db
    .insert(userGroups)
    .values(stampTenant({ userId, groupId }))
    .onConflictDoNothing();
  emit.toOrg(EV.USER_UPDATED, { id: userId, by: whoId, at: new Date().toISOString() });
  emit.toOrg(EV.GROUP_UPDATED, { id: groupId, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'group.member_add', target: `User added to group "${g[0].name}"` });
}

/**
 * F25: remove a single user from a group. Idempotent — silently succeeds
 * if the user wasn't in the group.
 */
export async function removeUserFromGroup(userId: string, groupId: string, whoId: string): Promise<void> {
  const g = await db.select().from(groups).where(and(eq(groups.id, groupId), tenantEq(groups.tenantId))).limit(1);
  if (!g[0]) throw new HttpError(404, 'group_not_found');
  await db
    .delete(userGroups)
    .where(and(eq(userGroups.userId, userId), eq(userGroups.groupId, groupId), tenantEq(userGroups.tenantId)));
  emit.toOrg(EV.USER_UPDATED, { id: userId, by: whoId, at: new Date().toISOString() });
  emit.toOrg(EV.GROUP_UPDATED, { id: groupId, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'group.member_remove', target: `User removed from group "${g[0].name}"` });
}

export async function getUserOverrides(userId: string) {
  return db
    .select({ permission: userPermissionOverrides.permissionKey, effect: userPermissionOverrides.effect })
    .from(userPermissionOverrides)
    .where(and(eq(userPermissionOverrides.userId, userId), tenantEq(userPermissionOverrides.tenantId)));
}

export async function setUserOverrides(
  userId: string,
  overrides: { permission: Permission; effect: 'grant' | 'deny' }[],
  whoId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(userPermissionOverrides).where(and(eq(userPermissionOverrides.userId, userId), tenantEq(userPermissionOverrides.tenantId)));
    if (overrides.length > 0) {
      await tx
        .insert(userPermissionOverrides)
        .values(overrides.map((o) => stampTenant({ userId, permissionKey: o.permission, effect: o.effect })));
    }
  });
  emit.toOrg(EV.USER_UPDATED, { id: userId, by: whoId, at: new Date().toISOString() });
}
