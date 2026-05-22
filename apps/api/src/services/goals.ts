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
import {
  isConnected as driveIsConnected,
  uploadFile as driveUploadFile,
  ensureProjectFolder,
} from './drive.js';

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
    description: input.description ?? null,
    status: input.status,
    ownerId: input.ownerId ?? null,
    startDate: input.startDate ?? null,
    endDate: input.endDate ?? null,
    priority: input.priority,
    tag: input.tag,
    checklist: input.checklist,
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
  if (patch.description !== undefined) upd.description = patch.description;
  if (patch.status !== undefined) upd.status = patch.status;
  if (patch.ownerId !== undefined) upd.ownerId = patch.ownerId;
  if (patch.startDate !== undefined) upd.startDate = patch.startDate;
  if (patch.endDate !== undefined) upd.endDate = patch.endDate;
  if (patch.priority !== undefined) upd.priority = patch.priority;
  if (patch.tag !== undefined) upd.tag = patch.tag;
  if (patch.checklist !== undefined) upd.checklist = patch.checklist;
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

/**
 * Upload a user-provided file (drag-drop / file-picker in the goal modal)
 * straight to Google Drive, into the project folder that this goal belongs
 * to, and record the upload as a goal_resources row. Folders are lazily
 * backfilled if the goal's client/project don't already have one.
 */
export async function uploadGoalResource(
  goalId: string,
  file: { originalname: string; mimetype: string; buffer: Buffer; size: number },
  whoId: string,
): Promise<GoalResource> {
  const [goal] = await db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
  if (!goal) throw new HttpError(404, 'goal_not_found');

  if (!(await driveIsConnected())) {
    throw new HttpError(503, 'drive_not_connected');
  }

  // Lazy-backfills client + project folders as needed, returns project folder id.
  const folderId = await ensureProjectFolder(goal.projectId);

  // Push the file into the project folder.
  const driveEntry = await driveUploadFile(folderId, file.originalname, file.mimetype, file.buffer);

  // Use 'drive-sheet' for spreadsheets, otherwise 'drive-doc' — both are
  // valid existing resource kinds so the icon picker keeps working.
  const kind = file.mimetype.includes('spreadsheet') ? 'drive-sheet' : 'drive-doc';

  const [row] = await db
    .insert(goalResources)
    .values({
      goalId,
      kind,
      title: file.originalname,
      url: driveEntry.webViewLink ?? '',
      meta: humanFileSize(file.size),
      driveFileId: driveEntry.id,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      addedBy: whoId,
    })
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
