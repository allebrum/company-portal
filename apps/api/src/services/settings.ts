import { eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appSettings, type AppSettingsRow } from '../db/schema.js';
import type { UpdateAppSettingsInput } from '@allebrum/shared';
import { EV } from '@allebrum/shared';
import { emit } from '../realtime/emit.js';
import { appendActivity } from './activity.js';

export async function getSettings(): Promise<AppSettingsRow> {
  const rows = await db.select().from(appSettings).limit(1);
  if (rows[0]) return rows[0];
  const [created] = await db.insert(appSettings).values({ id: 'singleton' }).returning();
  if (!created) throw new Error('failed to create app_settings singleton');
  return created;
}

export async function updateSettings(
  patch: UpdateAppSettingsInput,
  whoId: string,
): Promise<AppSettingsRow> {
  await getSettings();
  const upd: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (patch.passwordLoginEnabled !== undefined) upd.passwordLoginEnabled = patch.passwordLoginEnabled;
  if (patch.googleLoginEnabled !== undefined) upd.googleLoginEnabled = patch.googleLoginEnabled;
  if (patch.allowedEmailDomains !== undefined) upd.allowedEmailDomains = patch.allowedEmailDomains;
  if (patch.bookkeeperEmail !== undefined) upd.bookkeeperEmail = patch.bookkeeperEmail;
  if (patch.sendToBookkeeperOn !== undefined) upd.sendToBookkeeperOn = patch.sendToBookkeeperOn;
  const [row] = await db
    .update(appSettings)
    .set(upd)
    .where(eq(appSettings.id, 'singleton'))
    .returning();
  if (!row) throw new Error('app_settings update failed');
  emit.toOrg(EV.SETTINGS_UPDATED, { id: 'singleton', by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'settings.update', target: 'Workspace settings updated' });
  return row;
}
