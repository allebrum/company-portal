import { eq, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  goals,
  goalResources,
  type Goal,
  type GoalResource,
} from '../db/schema.js';
import type {
  CreateGoalInput,
  UpdateGoalInput,
  MoveGoalInput,
  AddResourceInput,
  GoalStatus,
} from '@allebrum/shared';
import { EV } from '@allebrum/shared';
import { emit } from '../realtime/emit.js';
import { appendActivity } from './activity.js';
import { HttpError } from '../middleware/errorHandler.js';

export async function listGoals(): Promise<(Goal & { resources: GoalResource[] })[]> {
  const allGoals = await db.select().from(goals).orderBy(asc(goals.createdAt));
  const allResources = await db.select().from(goalResources);
  const byGoal = new Map<string, GoalResource[]>();
  for (const r of allResources) {
    const arr = byGoal.get(r.goalId) ?? [];
    arr.push(r);
    byGoal.set(r.goalId, arr);
  }
  return allGoals.map((g) => ({ ...g, resources: byGoal.get(g.id) ?? [] }));
}

export async function createGoal(input: CreateGoalInput, whoId: string): Promise<Goal> {
  const [row] = await db.insert(goals).values({
    clientId: input.clientId,
    projectId: input.projectId,
    title: input.title,
    status: input.status,
    ownerId: input.ownerId ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    priority: input.priority,
    tag: input.tag,
  }).returning();
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
  if (patch.status !== undefined) upd.status = patch.status;
  if (patch.ownerId !== undefined) upd.ownerId = patch.ownerId;
  if (patch.startDate !== undefined) upd.startDate = patch.startDate;
  if (patch.endDate !== undefined) upd.endDate = patch.endDate;
  if (patch.priority !== undefined) upd.priority = patch.priority;
  if (patch.tag !== undefined) upd.tag = patch.tag;
  const [row] = await db.update(goals).set(upd).where(eq(goals.id, id)).returning();
  if (!row) throw new HttpError(404, 'goal_not_found');
  emit.toOrg(EV.GOAL_UPDATED, { id: row.id, by: whoId, at: new Date().toISOString() });
  return row;
}

export async function moveGoal(id: string, input: MoveGoalInput, whoId: string): Promise<Goal> {
  const [row] = await db
    .update(goals)
    .set({ status: input.status as GoalStatus, updatedAt: new Date().toISOString() })
    .where(eq(goals.id, id))
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
    .values({
      goalId,
      kind: input.kind,
      title: input.title,
      url: input.url,
      meta: input.meta,
      addedBy: whoId,
    })
    .returning();
  if (!row) throw new Error('resource insert failed');
  emit.toOrg(EV.GOAL_RESOURCE_ADDED, { id: goalId, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'resource.add', target: `${row.title} attached` });
  return row;
}

export async function removeResource(goalId: string, resourceId: string, whoId: string): Promise<void> {
  const [row] = await db.delete(goalResources).where(eq(goalResources.id, resourceId)).returning({ id: goalResources.id });
  if (!row) throw new HttpError(404, 'resource_not_found');
  emit.toOrg(EV.GOAL_RESOURCE_REMOVED, { id: goalId, by: whoId, at: new Date().toISOString() });
}
