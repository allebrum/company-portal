import { and, asc, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import type { FormDefinition, FormNotifications } from '@allebrum/shared';
import { db } from '../db/client.js';
import { forms, formSubmissions, payConfig, tenantMembers, type Form } from '../db/schema.js';
import { env } from '../env.js';
import { withTenant } from '../tenancy/context.js';
import { appendActivity } from './activity.js';
import { getGmailStatusForUser } from './gmail.js';
import { sendFormDigestEmail, sendFormSubmissionEmail } from './mail.js';
import {
  DEFAULT_TZ,
  digestDue,
  parsePgTimestamp,
  pickRecipients,
  resolveNotifications,
  submitterEmail,
  summarizeAnswers,
} from './formNotifyRules.js';
import { getSettings } from './settings.js';
import { listUsers } from './users.js';

/**
 * New-submission notifications for embedded forms.
 *
 * Before this module existed, `submitPublicForm` only inserted the row — no
 * email, no activity entry — so submissions were silent unless someone opened
 * the form. Now every ACCEPTED submission (honeypot hits and failed captchas
 * are rejected before insert, so they never reach here):
 *   - appends a `forms.submission` entry to the workspace activity feed, and
 *   - emails the form's recipients, immediately or in a daily digest.
 *
 * Mail goes through the workspace "system sender" (Settings → Email), the same
 * Gmail account used for password resets / portal invites. When no sender is
 * set or it isn't connected, mail.ts logs and no-ops; the form settings UI
 * warns about that via GET /api/forms/config.
 */

/** Cap on submissions rendered in one digest email (count still exact). */
const DIGEST_MAX_ITEMS = 25;

/** Must run inside withTenant(form.tenantId). */
async function recipientsFor(form: Form, cfg: FormNotifications): Promise<string[]> {
  const members = (await listUsers()).filter((u) => u.status === 'active');
  const owners = await db
    .select({ userId: tenantMembers.userId })
    .from(tenantMembers)
    .where(and(eq(tenantMembers.tenantId, form.tenantId), eq(tenantMembers.isOwner, true)));
  return pickRecipients({
    cfg,
    ownerUserId: form.ownerUserId,
    members,
    workspaceOwnerIds: owners.map((o) => o.userId),
  });
}

export function formsUrl(formId: string): string {
  return `${env.WEB_ORIGIN}/tools/forms?form=${encodeURIComponent(formId)}`;
}

/**
 * Fire-and-forget hook called after a submission is stored. Never throws —
 * the public submit response must not depend on mail delivery.
 */
export async function notifyNewSubmission(args: {
  form: Form;
  answers: Record<string, unknown>;
  submittedAt: string;
  referer: string | null;
}): Promise<void> {
  const { form } = args;
  try {
    await withTenant(form.tenantId, async () => {
      const definition = form.definition as FormDefinition;
      await appendActivity({
        whoId: null,
        kind: 'forms.submission',
        target: `New submission on “${form.name}”`,
        meta: { formId: form.id },
      }).catch((e) => console.error('[forms] activity append failed', e));

      const cfg = resolveNotifications(form.notifications);
      if (cfg.mode !== 'immediate') return;
      const to = await recipientsFor(form, cfg);
      if (to.length === 0) return;
      const settings = await getSettings();
      const lines = summarizeAnswers(definition, args.answers);
      const replyTo = submitterEmail(definition, args.answers);
      for (const rcpt of to) {
        await sendFormSubmissionEmail({
          senderUserId: settings.systemSenderUserId ?? null,
          to: rcpt,
          replyTo,
          formName: form.name,
          submittedAt: args.submittedAt,
          lines,
          pageUrl: args.referer,
          formsUrl: formsUrl(form.id),
        });
      }
    });
  } catch (e) {
    console.error(`[forms] notification failed for form ${form.id}`, e);
  }
}

// ---- Daily digest ----

/**
 * Atomically claim the digest window: move the watermark from `prev` to
 * `nowIso` only if nobody else already did. Returns false when another
 * container won the race.
 */
async function claimDigest(formId: string, prev: string | null, nowIso: string): Promise<boolean> {
  const rows = await db
    .update(forms)
    .set({ lastDigestAt: nowIso })
    .where(
      and(
        eq(forms.id, formId),
        prev === null ? isNull(forms.lastDigestAt) : eq(forms.lastDigestAt, prev),
      ),
    )
    .returning({ id: forms.id });
  return rows.length > 0;
}

export async function runDigestTick(now = new Date()): Promise<{ forms: number; emails: number }> {
  const candidates = await db
    .select()
    .from(forms)
    .where(and(isNull(forms.archivedAt), sql`${forms.notifications}->>'mode' = 'digest'`));
  if (candidates.length === 0) return { forms: 0, emails: 0 };

  const tzByTenant = new Map<string, string>();
  let sentForms = 0;
  let emails = 0;
  const nowIso = now.toISOString();

  for (const form of candidates) {
    try {
      if (!tzByTenant.has(form.tenantId)) {
        const [cfgRow] = await db
          .select({ timezone: payConfig.timezone })
          .from(payConfig)
          .where(eq(payConfig.tenantId, form.tenantId))
          .limit(1);
        tzByTenant.set(form.tenantId, cfgRow?.timezone || DEFAULT_TZ);
      }
      const tz = tzByTenant.get(form.tenantId)!;
      if (!digestDue(now, tz, form.lastDigestAt)) continue;

      // Window start: last digest, or the past 24h for a first digest.
      const since = form.lastDigestAt ? parsePgTimestamp(form.lastDigestAt).toISOString() : new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
      if (!(await claimDigest(form.id, form.lastDigestAt, nowIso))) continue;

      const subs = await db
        .select()
        .from(formSubmissions)
        .where(
          and(
            eq(formSubmissions.formId, form.id),
            eq(formSubmissions.tenantId, form.tenantId),
            gt(formSubmissions.submittedAt, since),
            lte(formSubmissions.submittedAt, nowIso),
          ),
        )
        .orderBy(asc(formSubmissions.submittedAt));
      if (subs.length === 0) continue;

      await withTenant(form.tenantId, async () => {
        const cfg = resolveNotifications(form.notifications);
        const to = await recipientsFor(form, cfg);
        if (to.length === 0) return;
        const settings = await getSettings();
        const definition = form.definition as FormDefinition;
        const items = subs.slice(-DIGEST_MAX_ITEMS).reverse().map((s) => ({
          submittedAt: s.submittedAt,
          lines: summarizeAnswers(definition, (s.answers ?? {}) as Record<string, unknown>),
        }));
        for (const rcpt of to) {
          await sendFormDigestEmail({
            senderUserId: settings.systemSenderUserId ?? null,
            to: rcpt,
            formName: form.name,
            total: subs.length,
            submissions: items,
            formsUrl: formsUrl(form.id),
          });
          emails += 1;
        }
        sentForms += 1;
      });
    } catch (e) {
      console.error(`[forms-digest] form ${form.id} failed`, e);
    }
  }
  return { forms: sentForms, emails };
}

/** Is the workspace system sender set + Gmail-connected? (tenant context) */
export async function senderStatus(): Promise<{ connected: boolean; name: string | null }> {
  const settings = await getSettings();
  const id = settings.systemSenderUserId ?? null;
  if (!id) return { connected: false, name: null };
  const [status, members] = await Promise.all([getGmailStatusForUser(id), listUsers()]);
  const user = members.find((m) => m.id === id);
  return { connected: !!status.connected, name: user?.name ?? null };
}
