import {
  DEFAULT_FORM_NOTIFICATIONS,
  FormNotificationsSchema,
  type FormDefinition,
  type FormNotifications,
} from '@allebrum/shared';

/**
 * Pure rules for form notifications (no DB / realtime imports so they are
 * unit-testable). Wired up in services/formNotifications.
 */

export type FormAnswerLine = { label: string; value: string };

/** Digest goes out at the first tick at/after this local hour (workspace tz). */
export const DIGEST_HOUR = 8;
export const DEFAULT_TZ = 'America/New_York';

export function resolveNotifications(raw: unknown): FormNotifications {
  if (raw == null) return { ...DEFAULT_FORM_NOTIFICATIONS };
  const parsed = FormNotificationsSchema.safeParse(raw);
  return parsed.success ? parsed.data : { ...DEFAULT_FORM_NOTIFICATIONS };
}

/** Human-readable label/value pairs in form-field order. */
export function summarizeAnswers(definition: FormDefinition, answers: Record<string, unknown>): FormAnswerLine[] {
  const lines: FormAnswerLine[] = [];
  for (const field of definition.fields ?? []) {
    if (!Object.prototype.hasOwnProperty.call(answers, field.id)) continue;
    const raw = answers[field.id];
    let value: string;
    if (Array.isArray(raw)) {
      const labels = new Map((field.options ?? []).map((o) => [o.value, o.label]));
      value = raw.map((v) => labels.get(String(v)) ?? String(v)).join(', ');
    } else if (typeof raw === 'boolean') {
      value = raw ? 'Yes' : 'No';
    } else if (raw == null) {
      value = '';
    } else {
      const s = String(raw);
      const opt = (field.options ?? []).find((o) => o.value === s);
      value = opt ? opt.label : s;
    }
    if (value.length > 2000) value = `${value.slice(0, 2000)}…`;
    lines.push({ label: field.label || field.id, value });
  }
  return lines;
}

const EMAIL_RE = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;

/** First email-type answer that looks like an address — used as Reply-To. */
export function submitterEmail(definition: FormDefinition, answers: Record<string, unknown>): string | null {
  for (const field of definition.fields ?? []) {
    if (field.type !== 'email') continue;
    const v = answers[field.id];
    if (typeof v === 'string' && EMAIL_RE.test(v.trim()) && v.length <= 320) return v.trim();
  }
  return null;
}

/**
 * Pure recipient resolution. `members` = active workspace users. Picked users
 * that aren't active members are dropped. If nothing resolves (empty selection,
 * or every picked user left) → the form owner, else the workspace owners. Case-insensitive de-dupe.
 */
export function pickRecipients(args: {
  cfg: FormNotifications;
  ownerUserId: string;
  members: { id: string; email: string }[];
  workspaceOwnerIds: string[];
}): string[] {
  const byId = new Map(args.members.map((m) => [m.id, m.email]));
  const out: string[] = [];
  for (const id of args.cfg.userIds) {
    const e = byId.get(id);
    if (e) out.push(e);
  }
  for (const e of args.cfg.emails) out.push(e);
  if (out.length === 0) {
    const owner = byId.get(args.ownerUserId);
    if (owner) out.push(owner);
    else for (const id of args.workspaceOwnerIds) {
      const e = byId.get(id);
      if (e) out.push(e);
    }
  }
  const seen = new Set<string>();
  return out.filter((e) => {
    const k = e.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function ymdInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function hourInTz(d: Date, tz: string): number {
  const s = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(d);
  return parseInt(s, 10) % 24;
}

/** Parse a Postgres timestamptz text ("2026-11-24 10:00:00.123+00") or ISO. */
export function parsePgTimestamp(v: string): Date {
  const iso = v.includes('T') ? v : v.replace(' ', 'T');
  const fixed = iso.replace(/([+-]\d{2})$/, '$1:00');
  return new Date(fixed);
}

/**
 * Is a digest due? Once per workspace-local day, at/after DIGEST_HOUR.
 * A null watermark (never sent) is due as soon as the window opens.
 */
export function digestDue(now: Date, tz: string, lastDigestAt: string | null): boolean {
  let zone = tz;
  try {
    ymdInTz(now, zone);
  } catch {
    zone = DEFAULT_TZ;
  }
  if (hourInTz(now, zone) < DIGEST_HOUR) return false;
  if (!lastDigestAt) return true;
  return ymdInTz(parsePgTimestamp(lastDigestAt), zone) !== ymdInTz(now, zone);
}

