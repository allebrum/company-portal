import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { payConfig, type PayConfig } from '../db/schema.js';
import type { PayConfigInput } from '@modernzen/shared';
import { appendActivity } from './activity.js';
import { emit } from '../realtime/emit.js';
import { EV } from '@modernzen/shared';
import { regenerateFuturePeriods } from './payPeriods.js';
import { currentTenantId } from '../tenancy/context.js';

// Modern Zen: pay_config is one row per workspace. Pay routes are always
// authenticated, so the active tenant is in the request context.
export async function getConfig(): Promise<PayConfig> {
  const tenantId = currentTenantId();
  const rows = await db.select().from(payConfig).where(eq(payConfig.tenantId, tenantId)).limit(1);
  if (rows[0]) return rows[0];
  const [created] = await db.insert(payConfig).values({ tenantId }).returning();
  if (!created) throw new Error('failed to create pay_config row');
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
  if (patch.autoClose !== undefined) upd.autoClose = patch.autoClose;
  if (patch.approverId !== undefined) upd.approverId = patch.approverId;
  const tenantId = currentTenantId();
  const [updated] = await db
    .update(payConfig)
    .set(upd)
    .where(eq(payConfig.tenantId, tenantId))
    .returning();
  if (!updated) throw new Error('pay_config update failed');
  emit.toOrg(EV.PAY_CONFIG_UPDATED, { id: tenantId, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'period.config', target: 'Pay schedule updated' });
  // Regenerate future periods from the new schedule so admins never need
  // to manually click "Generate". Errors logged but don't fail the save —
  // the config row is already updated and a subsequent /pay-periods GET
  // will lazy-fill via ensureFuturePeriods.
  try {
    await regenerateFuturePeriods({ whoId });
  } catch (e) {
    console.error('[pay-config] regenerateFuturePeriods failed', e);
  }
  return updated;
}
