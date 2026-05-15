import { desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { activityLog, type ActivityRow } from '../db/schema.js';
import { emit } from '../realtime/emit.js';
import { EV } from '@allebrum/shared';

export async function appendActivity(args: {
  whoId: string | null;
  kind: string;
  target: string;
  meta?: Record<string, unknown> | null;
}): Promise<ActivityRow> {
  const [row] = await db
    .insert(activityLog)
    .values({
      whoId: args.whoId,
      kind: args.kind,
      target: args.target,
      meta: args.meta ?? null,
    })
    .returning();
  if (!row) throw new Error('activity insert failed');
  emit.toOrg(EV.ACTIVITY_APPENDED, {
    id: row.id,
    whoId: row.whoId,
    kind: row.kind,
    target: row.target,
    meta: row.meta as Record<string, unknown> | null,
    createdAt: row.createdAt,
  });
  return row;
}

export async function listActivity(limit = 30): Promise<ActivityRow[]> {
  return db.select().from(activityLog).orderBy(desc(activityLog.createdAt)).limit(limit);
}
