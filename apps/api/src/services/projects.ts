import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { projects, timeEntries, type Project } from '../db/schema.js';
import type { CreateProjectInput, UpdateProjectInput } from '@allebrum/shared';
import { emit } from '../realtime/emit.js';
import { EV } from '@allebrum/shared';
import { appendActivity } from './activity.js';
import { HttpError } from '../middleware/errorHandler.js';
import { isConnected as driveIsConnected, ensureProjectFolder } from './drive.js';
import { tenantEq, stampTenant } from '../tenancy/scope.js';

export type ProjectWithMetrics = Project & {
  timeSpentMin: number;
};

async function buildProjectTimeSpentMap(): Promise<Map<string, number>> {
  const rows = await db
    .select({
      projectId: timeEntries.projectId,
      totalMin: sql<number>`COALESCE(SUM(${timeEntries.durationMin}), 0)::int`,
    })
    .from(timeEntries)
    .where(and(tenantEq(timeEntries.tenantId), isNotNull(timeEntries.projectId)))
    .groupBy(timeEntries.projectId);
  const out = new Map<string, number>();
  for (const row of rows) {
    if (!row.projectId) continue;
    out.set(row.projectId, Number(row.totalMin ?? 0));
  }
  return out;
}

async function withProjectMetrics(rows: Project[]): Promise<ProjectWithMetrics[]> {
  const spentByProject = await buildProjectTimeSpentMap();
  return rows.map((row) => ({
    ...row,
    timeSpentMin: spentByProject.get(row.id) ?? 0,
  }));
}

export async function listProjects(): Promise<ProjectWithMetrics[]> {
  const rows = await db.select().from(projects).where(tenantEq(projects.tenantId)).orderBy(asc(projects.name));
  return withProjectMetrics(rows);
}

export async function createProject(input: CreateProjectInput, whoId: string): Promise<ProjectWithMetrics> {
  const [inserted] = await db.insert(projects).values(stampTenant({
    clientId: input.clientId,
    name: input.name,
    code: input.code ?? '',
    opportunityStatus: input.opportunityStatus ?? 'pipeline',
    opportunityValue: input.opportunityValue ?? null,
    projectOverview: input.projectOverview ?? {},
    billable: input.billable,
    budgetHrs: input.budgetHrs,
    color: input.color,
    statuses: input.statuses ?? null,
  })).returning();
  if (!inserted) throw new Error('project insert failed');
  let row = inserted;

  // Best-effort: create the project's Drive folder. `ensureProjectFolder`
  // is race-safe — it backfills the parent client folder if missing (via
  // `ensureClientFolder`) and uses conditional UPDATEs that trash the
  // losing thread's orphan if two requests race. If Drive isn't connected
  // or the chain fails, `driveFolderId` stays null and uploads will
  // lazily try again later.
  try {
    if (await driveIsConnected()) {
      await ensureProjectFolder(row.id);
      const [updated] = await db
        .select()
        .from(projects)
        .where(and(eq(projects.id, row.id), tenantEq(projects.tenantId)))
        .limit(1);
      if (updated) row = updated;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[drive] failed to create folder for project "${row.name}":`, e instanceof Error ? e.message : e);
  }

  emit.toOrg(EV.PROJECT_CREATED, { id: row.id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'project.create', target: `${row.name} added` });
  const [hydrated] = await withProjectMetrics([row]);
  if (!hydrated) throw new Error('project hydration failed');
  return hydrated;
}

export async function updateProject(
  id: string,
  patch: UpdateProjectInput,
  whoId: string,
): Promise<ProjectWithMetrics> {
  const upd: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.clientId !== undefined) upd.clientId = patch.clientId;
  if (patch.name !== undefined) upd.name = patch.name;
  if (patch.code !== undefined) upd.code = patch.code;
  if (patch.opportunityStatus !== undefined) upd.opportunityStatus = patch.opportunityStatus;
  if (patch.opportunityValue !== undefined) upd.opportunityValue = patch.opportunityValue;
  if (patch.projectOverview !== undefined) upd.projectOverview = patch.projectOverview;
  if (patch.billable !== undefined) upd.billable = patch.billable;
  if (patch.budgetHrs !== undefined) upd.budgetHrs = patch.budgetHrs;
  if (patch.color !== undefined) upd.color = patch.color;
  if (patch.statuses !== undefined) upd.statuses = patch.statuses;
  if (patch.spaceBlocks !== undefined) upd.spaceBlocks = patch.spaceBlocks;
  if (patch.spaceFiles !== undefined) upd.spaceFiles = patch.spaceFiles;
  const [row] = await db.update(projects).set(upd).where(and(eq(projects.id, id), tenantEq(projects.tenantId))).returning();
  if (!row) throw new HttpError(404, 'project_not_found');
  emit.toOrg(EV.PROJECT_UPDATED, { id: row.id, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'project.update', target: `${row.name} updated` });
  const [hydrated] = await withProjectMetrics([row]);
  if (!hydrated) throw new Error('project hydration failed');
  return hydrated;
}
