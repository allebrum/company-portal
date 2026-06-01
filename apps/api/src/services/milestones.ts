import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { milestones, type Milestone } from '../db/schema.js';
import type { CreateMilestoneInput, UpdateMilestoneInput } from '@allebrum/shared';
import { HttpError } from '../middleware/errorHandler.js';
import { tenantEq, stampTenant } from '../tenancy/scope.js';

export async function listMilestones(): Promise<Milestone[]> {
  return db.select().from(milestones).where(tenantEq(milestones.tenantId)).orderBy(asc(milestones.date));
}

export async function createMilestone(input: CreateMilestoneInput): Promise<Milestone> {
  const [row] = await db
    .insert(milestones)
    .values(stampTenant({
      projectId: input.projectId,
      title: input.title,
      date: input.date,
      kind: input.kind,
      color: input.color,
    }))
    .returning();
  if (!row) throw new Error('milestone insert failed');
  return row;
}

export async function updateMilestone(id: string, patch: UpdateMilestoneInput): Promise<Milestone> {
  const upd: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.projectId !== undefined) upd.projectId = patch.projectId;
  if (patch.title !== undefined) upd.title = patch.title;
  if (patch.date !== undefined) upd.date = patch.date;
  if (patch.kind !== undefined) upd.kind = patch.kind;
  if (patch.color !== undefined) upd.color = patch.color;
  const [row] = await db.update(milestones).set(upd).where(and(eq(milestones.id, id), tenantEq(milestones.tenantId))).returning();
  if (!row) throw new HttpError(404, 'milestone_not_found');
  return row;
}

export async function deleteMilestone(id: string): Promise<void> {
  const [row] = await db.delete(milestones).where(and(eq(milestones.id, id), tenantEq(milestones.tenantId))).returning({ id: milestones.id });
  if (!row) throw new HttpError(404, 'milestone_not_found');
}
