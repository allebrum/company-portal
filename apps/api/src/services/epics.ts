import { and, asc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { epics, type Epic } from '../db/schema.js';
import type { CreateEpicInput, UpdateEpicInput } from '@modernzen/shared';
import { HttpError } from '../middleware/errorHandler.js';
import { tenantEq, stampTenant } from '../tenancy/scope.js';

export async function listEpics(): Promise<Epic[]> {
  return db.select().from(epics).where(tenantEq(epics.tenantId)).orderBy(asc(epics.createdAt));
}

export async function createEpic(input: CreateEpicInput): Promise<Epic> {
  const [row] = await db
    .insert(epics)
    .values(stampTenant({
      projectId: input.projectId,
      clientId: input.clientId,
      title: input.title,
      color: input.color,
      icon: input.icon,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
    }))
    .returning();
  if (!row) throw new Error('epic insert failed');
  return row;
}

export async function updateEpic(id: string, patch: UpdateEpicInput): Promise<Epic> {
  const upd: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.projectId !== undefined) upd.projectId = patch.projectId;
  if (patch.clientId !== undefined) upd.clientId = patch.clientId;
  if (patch.title !== undefined) upd.title = patch.title;
  if (patch.color !== undefined) upd.color = patch.color;
  if (patch.icon !== undefined) upd.icon = patch.icon;
  if (patch.startDate !== undefined) upd.startDate = patch.startDate;
  if (patch.endDate !== undefined) upd.endDate = patch.endDate;
  const [row] = await db.update(epics).set(upd).where(and(eq(epics.id, id), tenantEq(epics.tenantId))).returning();
  if (!row) throw new HttpError(404, 'epic_not_found');
  return row;
}

export async function deleteEpic(id: string): Promise<void> {
  const [row] = await db.delete(epics).where(and(eq(epics.id, id), tenantEq(epics.tenantId))).returning({ id: epics.id });
  if (!row) throw new HttpError(404, 'epic_not_found');
}
