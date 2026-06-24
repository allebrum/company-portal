import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { appSettings, oauthTokens, type AppSettingsRow } from '../db/schema.js';
import type { UpdateAppSettingsInput } from '@modernzen/shared';
import { EV } from '@modernzen/shared';
import { emit } from '../realtime/emit.js';
import { appendActivity } from './activity.js';
import { HttpError } from '../middleware/errorHandler.js';
import { currentTenantIdOrNull } from '../tenancy/context.js';
import { getDefaultTenantId } from './tenants.js';

/**
 * Modern Zen: app_settings is now one row per workspace. In-app calls resolve the
 * active workspace from the request context; pre-login calls (/auth/config,
 * the login gate) have no context and fall back to the DEFAULT workspace,
 * which governs the generic single-domain login surface.
 */
async function settingsTenantId(): Promise<string> {
  const t = currentTenantIdOrNull();
  if (t) return t;
  const def = await getDefaultTenantId();
  if (!def) throw new Error('no_default_tenant');
  return def;
}

export async function getSettings(): Promise<AppSettingsRow> {
  const tenantId = await settingsTenantId();
  const rows = await db.select().from(appSettings).where(eq(appSettings.tenantId, tenantId)).limit(1);
  if (rows[0]) return rows[0];
  const [created] = await db.insert(appSettings).values({ tenantId }).returning();
  if (!created) throw new Error('failed to create app_settings row');
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
  if (patch.termsUrl !== undefined) upd.termsUrl = patch.termsUrl;
  if (patch.privacyUrl !== undefined) upd.privacyUrl = patch.privacyUrl;
  if (patch.portalName !== undefined) upd.portalName = patch.portalName;
  if (patch.brandPrimaryColor !== undefined) upd.brandPrimaryColor = patch.brandPrimaryColor;
  if (patch.brandLogoDataUrl !== undefined) upd.brandLogoDataUrl = patch.brandLogoDataUrl;
  if (patch.systemSenderUserId !== undefined) {
    // Designating a system sender — only valid if that user actually has a
    // Gmail OAuth token, otherwise password-reset emails will silently
    // log instead of sending and the admin will be confused. (Setting it
    // to null is always allowed — that's how you clear it.)
    if (patch.systemSenderUserId !== null) {
      const rows = await db
        .select({ userId: oauthTokens.userId })
        .from(oauthTokens)
        .where(and(
          eq(oauthTokens.userId, patch.systemSenderUserId),
          eq(oauthTokens.provider, 'google_gmail'),
        ))
        .limit(1);
      if (!rows[0]) throw new HttpError(400, 'system_sender_not_connected');
    }
    upd.systemSenderUserId = patch.systemSenderUserId;
  }
  const tenantId = await settingsTenantId();
  const [row] = await db
    .update(appSettings)
    .set(upd)
    .where(eq(appSettings.tenantId, tenantId))
    .returning();
  if (!row) throw new Error('app_settings update failed');
  emit.toOrg(EV.SETTINGS_UPDATED, { id: tenantId, by: whoId, at: new Date().toISOString() });
  await appendActivity({ whoId, kind: 'settings.update', target: 'Workspace settings updated' });
  return row;
}
