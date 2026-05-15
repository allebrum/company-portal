import { asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { projects, type Project } from '../db/schema.js';
import type { CreateProjectInput, UpdateProjectInput } from '@allebrum/shared';
import { emit } from '../realtime/emit.js';
import { EV } from '@allebrum/shared';
import { appendActivity } from './activity.js';
import { HttpError } from '../middleware/errorHandler.js';

export async function listProjects(): Promise<Project[]> {
  return db.select().from(projects).orderBy(asc(projects.name));
}

export async function createProject(input: CreateProjectInput, whoId: string): Promise<Project> {
  const [row] = await db.insert(projects).values({
    clientId: input.clientId,
    name: input.name,
    code: input.code ?? '',
    billable: input.billable,
    budgetHrs: input.budgetHrs,
    color: input.color,
  }).returning();
  if (!row) throw new Error('project insert failed');
  emit.toOrg(EV.PROJECT_CREATED, { id: row.id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'project.create', target: `${row.name} added` });
  return row;
}

export async function updateProject(
  id: string,
  patch: UpdateProjectInput,
  whoId: string,
): Promise<Project> {
  const upd: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.clientId !== undefined) upd.clientId = patch.clientId;
  if (patch.name !== undefined) upd.name = patch.name;
  if (patch.code !== undefined) upd.code = patch.code;
  if (patch.billable !== undefined) upd.billable = patch.billable;
  if (patch.budgetHrs !== undefined) upd.budgetHrs = patch.budgetHrs;
  if (patch.color !== undefined) upd.color = patch.color;
  const [row] = await db.update(projects).set(upd).where(eq(projects.id, id)).returning();
  if (!row) throw new HttpError(404, 'project_not_found');
  emit.toOrg(EV.PROJECT_UPDATED, { id: row.id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'project.update', target: `${row.name} updated` });
  return row;
}
