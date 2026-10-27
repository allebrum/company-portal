import { desc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { activityLog, type ActivityRow } from '../db/schema.js';
import { emit } from '../realtime/emit.js';
import { EV } from '@allebrum/shared';
import { tenantEq, stampTenant } from '../tenancy/scope.js';
import { tokenActivityMeta } from '../lib/requestActor.js';

export async function appendActivity(args: {
  whoId: string | null;
  kind: string;
  target: string;
  meta?: Record<string, unknown> | null;
}): Promise<ActivityRow> {
  // Audit: actions made through a personal access token are tagged with the
  // token (id + name) so the feed can show "via API token".
  const via = tokenActivityMeta();
  const meta = via ? { ...(args.meta ?? {}), ...via } : (args.meta ?? null);
  const [row] = await db
    .insert(activityLog)
    .values(stampTenant({
      whoId: args.whoId,
      kind: args.kind,
      target: args.target,
      meta,
    }))
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
  return db
    .select()
    .from(activityLog)
    .where(tenantEq(activityLog.tenantId))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);
}
