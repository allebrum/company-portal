import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { payConfig, type PayConfig } from '../db/schema.js';
import type { PayConfigInput } from '@allebrum/shared';
import { appendActivity } from './activity.js';
import { emit } from '../realtime/emit.js';
import { EV } from '@allebrum/shared';

export async function getConfig(): Promise<PayConfig> {
  const rows = await db.select().from(payConfig).limit(1);
  if (rows[0]) return rows[0];
  const [created] = await db
    .insert(payConfig)
    .values({ id: 'singleton' })
    .returning();
  if (!created) throw new Error('failed to create pay_config singleton');
  return created;
}

export async function updateConfig(patch: Partial<PayConfigInput>, whoId: string): Promise<PayConfig> {
  await getConfig();
  const upd: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.cadence !== undefined) upd.cadence = patch.cadence;
  if (patch.payDates !== undefined) upd.payDates = patch.payDates;
  if (patch.weekendRule !== undefined) upd.weekendRule = patch.weekendRule;
  if (patch.anchor !== undefined) upd.anchor = patch.anchor;
  if (patch.processingBufferDays !== undefined) upd.processingBufferDays = patch.processingBufferDays;
  if (patch.payDelayDays !== undefined) upd.payDelayDays = patch.payDelayDays;
  if (patch.autoClose !== undefined) upd.autoClose = patch.autoClose;
  if (patch.approverId !== undefined) upd.approverId = patch.approverId;
  const [updated] = await db
    .update(payConfig)
    .set(upd)
    .where(eq(payConfig.id, 'singleton'))
    .returning();
  if (!updated) throw new Error('pay_config update failed');
  emit.toOrg(EV.PAY_CONFIG_UPDATED, { id: 'singleton', by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'period.config', target: 'Pay schedule updated' });
  return updated;
}
