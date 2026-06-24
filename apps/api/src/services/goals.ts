import { and, eq, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  goals,
  goalResources,
  type Goal,
  type GoalResource,
} from '../db/schema.js';
import { tenantEq, stampTenant } from '../tenancy/scope.js';
import type {
  CreateGoalInput,
  UpdateGoalInput,
  MoveGoalInput,
  AddResourceInput,
} from '@modernzen/shared';
import { EV } from '@modernzen/shared';
import { emit } from '../realtime/emit.js';
import { appendActivity } from './activity.js';
import { HttpError } from '../middleware/errorHandler.js';
import { uploadObject } from './storage.js';
import { currentTenantId } from '../tenancy/context.js';

export async function listGoals(): Promise<(Goal & { resources: GoalResource[] })[]> {
  const allGoals = await db.select().from(goals).where(tenantEq(goals.tenantId)).orderBy(asc(goals.createdAt));
  const allResources = await db.select().from(goalResources).where(tenantEq(goalResources.tenantId));
  const byGoal = new Map<string, GoalResource[]>();
  for (const r of allResources) {
    const arr = byGoal.get(r.goalId) ?? [];
    arr.push(r);
    byGoal.set(r.goalId, arr);
  }
  return allGoals.map((g) => ({ ...g, resources: byGoal.get(g.id) ?? [] }));
}

export async function createGoal(input: CreateGoalInput, whoId: string): Promise<Goal> {
  // F25: owner is EITHER a user OR a group. If a group is set, leave the
  // user owner null so the XOR CHECK holds.
  const ownerId = input.ownerGroupId != null ? null : (input.ownerId ?? null);
  const [row] = await db.insert(goals).values(stampTenant({
    // Both nullable since 0026 — null/null = workspace-level goal.
    clientId: input.clientId ?? null,
    projectId: input.projectId ?? null,
    title: input.title,
    description: input.description ?? null,
    status: input.status,
    ownerId,
    ownerGroupId: input.ownerGroupId ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    priority: input.priority,
    tag: input.tag,
    checklist: input.checklist,
    epicId: input.epicId ?? null,
    health: input.health ?? null,
    progress: input.progress ?? null,
    dependsOn: input.dependsOn ?? null,
    sharedWithClient: input.sharedWithClient ?? false,
  })).returning();
  if (!row) throw new Error('goal insert failed');
  emit.toOrg(EV.GOAL_CREATED, { id: row.id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'goal.create', target: `${row.title} added` });
  return row;
}

export async function updateGoal(id: string, patch: UpdateGoalInput, whoId: string): Promise<Goal> {
  const upd: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.clientId !== undefined) upd.clientId = patch.clientId;
  if (patch.projectId !== undefined) upd.projectId = patch.projectId;
  if (patch.title !== undefined) upd.title = patch.title;
  if (patch.description !== undefined) upd.description = patch.description;
  if (patch.status !== undefined) upd.status = patch.status;
  // F25: setting one of (ownerId, ownerGroupId) clears the other so the DB
  // XOR CHECK holds without requiring callers to know.
  if (patch.ownerId !== undefined) {
    upd.ownerId = patch.ownerId;
    if (patch.ownerId != null) upd.ownerGroupId = null;
  }
  if (patch.ownerGroupId !== undefined) {
    upd.ownerGroupId = patch.ownerGroupId;
    if (patch.ownerGroupId != null) upd.ownerId = null;
  }
  if (patch.startDate !== undefined) upd.startDate = patch.startDate;
  if (patch.endDate !== undefined) upd.endDate = patch.endDate;
  if (patch.priority !== undefined) upd.priority = patch.priority;
  if (patch.tag !== undefined) upd.tag = patch.tag;
  if (patch.checklist !== undefined) upd.checklist = patch.checklist;
  if (patch.epicId !== undefined) upd.epicId = patch.epicId;
  if (patch.health !== undefined) upd.health = patch.health;
  if (patch.progress !== undefined) upd.progress = patch.progress;
  if (patch.dependsOn !== undefined) upd.dependsOn = patch.dependsOn;
  if (patch.sharedWithClient !== undefined) upd.sharedWithClient = patch.sharedWithClient;
  const [row] = await db.update(goals).set(upd).where(and(eq(goals.id, id), tenantEq(goals.tenantId))).returning();
  if (!row) throw new HttpError(404, 'goal_not_found');
  emit.toOrg(EV.GOAL_UPDATED, { id: row.id, by: whoId, at: new Date().toISOString() });
  return row;
}

export async function moveGoal(id: string, input: MoveGoalInput, whoId: string): Promise<Goal> {
  const [row] = await db
    .update(goals)
    .set({ status: input.status, updatedAt: new Date().toISOString() })
    .where(and(eq(goals.id, id), tenantEq(goals.tenantId)))
    .returning();
  if (!row) throw new HttpError(404, 'goal_not_found');
  emit.toOrg(EV.GOAL_MOVED, { id: row.id, by: whoId, at: new Date().toISOString() });
  await appendActivity({
    whoId,
    kind: 'goal.move',
    target: `${row.title} → ${input.status}`,
  });
  return row;
}

export async function addResource(
  goalId: string,
  input: AddResourceInput,
  whoId: string,
): Promise<GoalResource> {
  const [row] = await db
    .insert(goalResources)
    .values(stampTenant({
      goalId,
      kind: input.kind,
      title: input.title,
      url: input.url,
      meta: input.meta,
      addedBy: whoId,
    }))
    .returning();
  if (!row) throw new Error('resource insert failed');
  emit.toOrg(EV.GOAL_RESOURCE_ADDED, { id: goalId, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'resource.add', target: `${row.title} attached` });
  return row;
}

export async function removeResource(goalId: string, resourceId: string, whoId: string): Promise<void> {
  const [row] = await db.delete(goalResources).where(and(eq(goalResources.id, resourceId), tenantEq(goalResources.tenantId))).returning({ id: goalResources.id });
  if (!row) throw new HttpError(404, 'resource_not_found');
  emit.toOrg(EV.GOAL_RESOURCE_REMOVED, { id: goalId, by: whoId, at: new Date().toISOString() });
}

export async function renameGoalResource(
  goalId: string,
  resourceId: string,
  title: string,
  whoId: string,
): Promise<GoalResource> {
  const nextTitle = title.trim();
  if (!nextTitle) throw new HttpError(400, 'title_required');

  const [existing] = await db
    .select()
    .from(goalResources)
    .where(eq(goalResources.id, resourceId))
    .limit(1);
  if (!existing || existing.goalId !== goalId) throw new HttpError(404, 'resource_not_found');

  // Storage objects (and external links) aren't renamed in place — only the
  // display title changes.
  const [row] = await db
    .update(goalResources)
    .set({ title: nextTitle })
    .where(eq(goalResources.id, resourceId))
    .returning();
  if (!row) throw new HttpError(404, 'resource_not_found');

  emit.toOrg(EV.GOAL_RESOURCE_ADDED, { id: goalId, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'resource.rename', target: `${existing.title} → ${nextTitle}` });
  return row;
}

/**
 * Upload a user-provided file (drag-drop / file-picker in the goal modal) to
 * Supabase Storage and record it as a goal_resources row. Works for any goal
 * (no parent-project requirement) and needs no Google Drive connection. The
 * Storage object key is stored in `driveFileId` (legacy column name).
 */
export async function uploadGoalResource(
  goalId: string,
  file: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  whoId: string,
): Promise<GoalResource> {
  const [goal] = await db.select().from(goals).where(and(eq(goals.id, goalId), tenantEq(goals.tenantId))).limit(1);
  if (!goal) throw new HttpError(404, 'goal_not_found');

  const stored = await uploadObject({
    tenantId: currentTenantId(),
    scopeKind: 'goal',
    scopeId: goalId,
    filename: file.originalname,
    mimeType: file.mimetype,
    buffer: file.buffer,
  });

  // Use 'drive-sheet' for spreadsheets, otherwise 'drive-doc' — both are valid
  // existing resource kinds so the icon picker keeps working.
  const kind = file.mimetype.includes('spreadsheet') ? 'drive-sheet' : 'drive-doc';

  const [row] = await db
    .insert(goalResources)
    .values(stampTenant({
      goalId,
      kind,
      title: file.originalname,
      url: stored.url,
      meta: humanFileSize(file.size),
      driveFileId: stored.key,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      addedBy: whoId,
    }))
    .returning();
  if (!row) throw new Error('resource insert failed');

  emit.toOrg(EV.GOAL_RESOURCE_ADDED, { id: goalId, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'resource.add', target: `${row.title} uploaded` });
  return row;
}

function humanFileSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let u = 0;
  let n = bytes;
  while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
  return `${n.toFixed(n >= 10 ? 0 : 1)} ${units[u]}`;
}
