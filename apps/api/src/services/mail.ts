import { sendAsUser } from './gmail.js';
import { HttpError } from '../middleware/errorHandler.js';

/**
 * Thin transactional-mail layer on top of the Gmail OAuth integration.
 * Every call requires a `senderUserId` — the teammate whose Gmail account
 * will deliver the message:
 *
 *  - Invite + resend-invite use the inviter (the admin who clicked Invite).
 *  - Password-reset uses the workspace's designated "system sender"
 *    (`app_settings.system_sender_user_id`).
 *
 * If `senderUserId` is null OR that user hasn't connected Gmail yet, we
 * log the would-be message + the action URL and no-op. Routes never throw
 * on a missing sender — the invite still creates the user row, the reset
 * token still gets issued — so the surrounding feature degrades to "the
 * admin needs to connect Gmail" instead of a hard failure.
 */
async function send(
  senderUserId: string | null | undefined,
  to: string,
  subject: string,
  html: string,
  text: string,
  cc?: string | null,
): Promise<void> {
  const rcpt = cc ? `to=${to} cc=${cc}` : `to=${to}`;
  if (!senderUserId) {
    console.log(`[mail] no sender configured — would send ${rcpt} subject=${JSON.stringify(subject)}`);
    console.log(text);
    return;
  }
  try {
    await sendAsUser(senderUserId, { to, cc, subject, html, text });
  } catch (e) {
    // 412 = sender hasn't connected Gmail yet. Log so the admin sees the
    // action URL and can hand-deliver while they finish the OAuth flow.
    if (e instanceof HttpError && e.status === 412) {
      console.log(`[mail] sender ${senderUserId} has not connected Gmail — would send ${rcpt} subject=${JSON.stringify(subject)}`);
      console.log(text);
      return;
    }
    // Anything else (Gmail API quota, revoked grant, etc.) gets logged
    // loudly but does NOT propagate — the broader request shouldn't die.
    console.error('[mail] send failed', e);
  }
}

// ---- Templated emails ----

export async function sendInviteEmail(args: {
  senderUserId: string | null;
  to: string;
  inviterName: string;
  acceptUrl: string;
  expiresAt: Date;
}): Promise<void> {
  const subject = "You've been invited to Allebrum";
  const expiresStr = args.expiresAt.toUTCString();
  const text = [
    `${args.inviterName} added you to the Allebrum portal.`,
    '',
    'Click the link below to set your password and finish signing in:',
    args.acceptUrl,
    '',
    `This invite link expires on ${expiresStr}. If it's expired, ask ${args.inviterName} to resend it.`,
    '',
    '— The Allebrum team',
  ].join('\n');
  const html = wrap(`
    <h2 style="margin:0 0 12px 0;font-size:20px;color:#111;">You've been invited to Allebrum</h2>
    <p style="margin:0 0 16px 0;color:#374151;">
      <strong>${esc(args.inviterName)}</strong> added you to the Allebrum portal. Click below to set your password and finish signing in.
    </p>
    ${button(args.acceptUrl, 'Accept invite & set password')}
    <p style="margin:24px 0 0 0;font-size:13px;color:#6b7280;">
      This invite link expires on ${esc(expiresStr)}. If it expires, ask ${esc(args.inviterName)} to resend it.
    </p>
    <p style="margin:8px 0 0 0;font-size:12px;color:#9ca3af;">
      Trouble with the button? Paste this URL into your browser:<br>
      <span style="word-break:break-all;">${esc(args.acceptUrl)}</span>
    </p>
  `);
  await send(args.senderUserId, args.to, subject, html, text);
}

/**
 * F23 — magic-link email for an external client contact. Single-use
 * 30-day URL that auto-signs them into their workspace's public portal
 * at /portal/{slug}. Sent via the workspace's system-sender Gmail
 * account (F4); falls back to log-only if not connected.
 */
export async function sendClientPortalInviteEmail(args: {
  senderUserId: string | null;
  to: string;
  contactName: string;
  clientName: string;
  inviterName: string;
  portalUrl: string;
  expiresAt: Date;
}): Promise<void> {
  const subject = `Your ${args.clientName} portal is ready`;
  const expiresStr = args.expiresAt.toUTCString();
  const text = [
    `Hi ${args.contactName},`,
    '',
    `${args.inviterName} set up a portal for ${args.clientName} where you can`,
    'see project status, milestones, and submit tickets.',
    '',
    'Open your portal:',
    args.portalUrl,
    '',
    `This sign-in link expires on ${expiresStr}. If it expires, request a new one`,
    "from the portal's sign-in page.",
    '',
    `— The ${args.clientName} team at Allebrum`,
  ].join('\n');
  const html = wrap(`
    <h2 style="margin:0 0 12px 0;font-size:20px;color:#111;">
      Your ${esc(args.clientName)} portal is ready
    </h2>
    <p style="margin:0 0 16px 0;color:#374151;">
      Hi ${esc(args.contactName)} — <strong>${esc(args.inviterName)}</strong> set up a portal
      for ${esc(args.clientName)} where you can see project status, milestones,
      and open tickets. Click below to sign in.
    </p>
    ${button(args.portalUrl, 'Open my portal')}
    <p style="margin:24px 0 0 0;font-size:13px;color:#6b7280;">
      This sign-in link expires on ${esc(expiresStr)}. If it expires you can request
      a new one from the portal's sign-in page.
    </p>
    <p style="margin:8px 0 0 0;font-size:12px;color:#9ca3af;">
      Trouble with the button? Paste this URL into your browser:<br>
      <span style="word-break:break-all;">${esc(args.portalUrl)}</span>
    </p>
  `);
  await send(args.senderUserId, args.to, subject, html, text);
}

/**
 * Payroll-summary email to the bookkeeper. Per-employee table inline in
 * the body (HTML + plain-text). Fires from the admin who clicked the
 * "Close & send" CTA — the From: is their connected Gmail.
 */
export type PayrollEntryRow = {
  /** ISO date (yyyy-mm-dd) — local date the work happened on */
  date: string;
  /** HH:MM clock string in the entry's recorded timezone */
  start: string;
  /** HH:MM clock string; '—' for entries with no end (shouldn't happen post-stop) */
  end: string;
  durationMin: number;
  project: string;
  note: string;
  status: string;
  /** Name of the admin who approved this entry, or '—' if not yet approved. */
  approver: string;
};
export type PayrollSummaryRow = {
  name: string;
  email: string;
  hours: number;
  revenue: number;
  approvers: string[];
  statuses: string[];
  /**
   * Every time entry that contributed to this row. The bookkeeper email
   * renders them as a per-employee detail table below the summary so the
   * recipient has the full audit trail (who logged what, when, who
   * approved it) without needing portal access.
   */
  entries: PayrollEntryRow[];
};
export async function sendPayrollReportEmail(args: {
  senderUserId: string | null;
  to: string;
  /** Comma-separated CC list (the rest of the bookkeeping team). */
  cc?: string | null;
  period: { label: string; startDate: string; endDate: string; payDate: string; status: string };
  summaries: PayrollSummaryRow[];
}): Promise<void> {
  const { period, summaries } = args;
  const totalHours = summaries.reduce((s, r) => s + r.hours, 0);
  const totalRev = summaries.reduce((s, r) => s + r.revenue, 0);
  const fmtHrs = (h: number) => `${h.toFixed(2)}h`;
  const fmt$ = (v: number) => v.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

  const subject = `Payroll · ${period.label}`;
  const fmtDur = (m: number) => {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}:${String(mm).padStart(2, '0')}`;
  };
  // Plain-text variant — keep it useful for terminal-style mail clients
  // and as a graceful fallback. Detail rows are right-aligned columns
  // separated by 2-space gaps; no fancy box-drawing chars so any mailer
  // renders cleanly.
  const text = [
    `Pay period: ${period.label}`,
    `Range:      ${period.startDate} – ${period.endDate}`,
    `Pay date:   ${period.payDate}`,
    `Status:     ${period.status}`,
    '',
    'Per-employee summary:',
    ...summaries.map(
      (r) =>
        `  ${r.name} <${r.email}>  ${fmtHrs(r.hours)}  ${fmt$(r.revenue)}` +
        `  (approved by: ${r.approvers.join(', ') || '—'})`,
    ),
    '',
    `Totals: ${fmtHrs(totalHours)}  ${fmt$(totalRev)}`,
    '',
    'Detail by employee:',
    ...summaries.flatMap((r) => [
      '',
      `── ${r.name} <${r.email}> — ${fmtHrs(r.hours)} · ${fmt$(r.revenue)}`,
      '  Date        Start  End    Duration  Project              Status     Approver           Note',
      ...r.entries.map(
        (e) =>
          `  ${e.date}  ${e.start.padEnd(5)}  ${e.end.padEnd(5)}  ${fmtDur(e.durationMin).padStart(7)}  ` +
          `${e.project.slice(0, 20).padEnd(20)} ${e.status.padEnd(10)} ${e.approver.slice(0, 18).padEnd(18)} ${e.note}`,
      ),
    ]),
    '',
    '— Sent from the Allebrum portal',
  ].join('\n');

  const rowsHtml = summaries
    .map(
      (r) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;">${esc(r.name)}<br><span style="color:#6b7280;font-size:12px;">${esc(r.email)}</span></td>
        <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;text-align:right;font-variant-numeric:tabular-nums;">${esc(fmtHrs(r.hours))}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;text-align:right;font-variant-numeric:tabular-nums;">${esc(fmt$(r.revenue))}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px;">${esc(r.approvers.join(', ') || '—')}</td>
      </tr>`,
    )
    .join('');

  // Per-employee detail blocks — mirror the in-app review modal's
  // expanded view so the bookkeeper sees every entry plus the
  // approving admin without having to log into the portal.
  const cellThStyle =
    'padding:6px 8px;border-bottom:1px solid #e5e7eb;font-size:10px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;';
  const cellTdStyle =
    'padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:12px;color:#374151;';
  const detailHtml = summaries
    .map((r) => {
      const entryRows =
        r.entries.length === 0
          ? `<tr><td colspan="8" style="padding:8px;text-align:center;color:#9ca3af;font-size:12px;">No entries.</td></tr>`
          : r.entries
              .map(
                (e) => `
            <tr>
              <td style="${cellTdStyle}white-space:nowrap;font-variant-numeric:tabular-nums;">${esc(e.date)}</td>
              <td style="${cellTdStyle}white-space:nowrap;font-variant-numeric:tabular-nums;text-align:right;">${esc(e.start)}</td>
              <td style="${cellTdStyle}white-space:nowrap;font-variant-numeric:tabular-nums;text-align:right;">${esc(e.end)}</td>
              <td style="${cellTdStyle}white-space:nowrap;font-variant-numeric:tabular-nums;text-align:right;font-weight:600;">${esc(fmtDur(e.durationMin))}</td>
              <td style="${cellTdStyle}">${esc(e.project)}</td>
              <td style="${cellTdStyle}">${esc(e.note)}</td>
              <td style="${cellTdStyle}"><span style="display:inline-block;padding:1px 8px;border-radius:999px;background:#f3f4f6;font-size:11px;color:#374151;">${esc(e.status)}</span></td>
              <td style="${cellTdStyle}color:#6b7280;">${esc(e.approver)}</td>
            </tr>`,
              )
              .join('');
      return `
        <div style="margin-top:22px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
          <div style="background:#f9fafb;padding:10px 14px;border-bottom:1px solid #e5e7eb;">
            <div style="font-size:14px;font-weight:600;color:#111;">${esc(r.name)}</div>
            <div style="font-size:12px;color:#6b7280;">
              ${esc(r.email)} · <strong style="color:#111;">${esc(fmtHrs(r.hours))}</strong>
              · ${esc(fmt$(r.revenue))} billable
              · approved by ${esc(r.approvers.join(', ') || '—')}
            </div>
          </div>
          <div style="overflow-x:auto;">
            <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:12px;">
              <thead>
                <tr>
                  <th align="left" style="${cellThStyle}">Date</th>
                  <th align="right" style="${cellThStyle}">Start</th>
                  <th align="right" style="${cellThStyle}">End</th>
                  <th align="right" style="${cellThStyle}">Duration</th>
                  <th align="left" style="${cellThStyle}">Project</th>
                  <th align="left" style="${cellThStyle}">Note</th>
                  <th align="left" style="${cellThStyle}">Status</th>
                  <th align="left" style="${cellThStyle}">Approver</th>
                </tr>
              </thead>
              <tbody>${entryRows}</tbody>
            </table>
          </div>
        </div>`;
    })
    .join('');

  const html = wrap(`
    <h2 style="margin:0 0 6px 0;font-size:20px;color:#111;">Payroll · ${esc(period.label)}</h2>
    <p style="margin:0 0 16px 0;color:#374151;font-size:13px;">
      <strong>Range:</strong> ${esc(period.startDate)} – ${esc(period.endDate)}<br>
      <strong>Pay date:</strong> ${esc(period.payDate)}<br>
      <strong>Status:</strong> ${esc(period.status)}
    </p>
    <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead>
        <tr>
          <th align="left" style="padding:8px 10px;border-bottom:2px solid #e5e7eb;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;">Employee</th>
          <th align="right" style="padding:8px 10px;border-bottom:2px solid #e5e7eb;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;">Hours</th>
          <th align="right" style="padding:8px 10px;border-bottom:2px solid #e5e7eb;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;">Billable</th>
          <th align="left" style="padding:8px 10px;border-bottom:2px solid #e5e7eb;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;">Approvers</th>
        </tr>
      </thead>
      <tbody>${rowsHtml || '<tr><td colspan="4" style="padding:16px;text-align:center;color:#9ca3af;font-size:13px;">No entries in this period.</td></tr>'}</tbody>
      <tfoot>
        <tr>
          <td style="padding:10px;font-weight:600;color:#111;">Totals</td>
          <td style="padding:10px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${esc(fmtHrs(totalHours))}</td>
          <td style="padding:10px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums;">${esc(fmt$(totalRev))}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
    ${summaries.length > 0 ? `
      <h3 style="margin:32px 0 4px 0;font-size:15px;color:#111;">Detail by employee</h3>
      <p style="margin:0 0 8px 0;font-size:12px;color:#6b7280;">
        Every entry that contributed to the totals above, including the
        approving admin. Sorted by employee.
      </p>
      ${detailHtml}
    ` : ''}
  `);

  await send(args.senderUserId, args.to, subject, html, text, args.cc);
}

export async function sendResetEmail(args: {
  senderUserId: string | null;
  to: string;
  name: string;
  resetUrl: string;
  expiresAt: Date;
}): Promise<void> {
  const subject = 'Reset your Allebrum password';
  const expiresStr = args.expiresAt.toUTCString();
  const text = [
    `Hi ${args.name},`,
    '',
    'Someone (hopefully you) asked to reset the password for your Allebrum account.',
    'Click the link below to choose a new password:',
    args.resetUrl,
    '',
    `This link expires on ${expiresStr}.`,
    "If you didn't request this, you can ignore this email — your password stays the same.",
    '',
    '— The Allebrum team',
  ].join('\n');
  const html = wrap(`
    <h2 style="margin:0 0 12px 0;font-size:20px;color:#111;">Reset your Allebrum password</h2>
    <p style="margin:0 0 16px 0;color:#374151;">
      Hi ${esc(args.name)}, someone (hopefully you) asked to reset the password for your Allebrum account. Click below to choose a new one.
    </p>
    ${button(args.resetUrl, 'Choose a new password')}
    <p style="margin:24px 0 0 0;font-size:13px;color:#6b7280;">
      This link expires on ${esc(expiresStr)}. If you didn't request a reset, you can ignore this email — your password stays the same.
    </p>
    <p style="margin:8px 0 0 0;font-size:12px;color:#9ca3af;">
      Trouble with the button? Paste this URL into your browser:<br>
      <span style="word-break:break-all;">${esc(args.resetUrl)}</span>
    </p>
  `);
  await send(args.senderUserId, args.to, subject, html, text);
}

/**
 * Sprint 4 follow-up — client-facing ticket notifications. Sent to the
 * portal contact who opened the ticket whenever STAFF act on it (reply, or
 * a status change the client should know about). Client-initiated changes
 * never email the client back. Sender = the acting staffer's connected
 * Gmail; the usual log-and-noop fallback applies when not connected.
 */
export async function sendTicketUpdateEmail(args: {
  senderUserId: string | null;
  to: string;
  contactName: string;
  clientName: string;
  ticketTitle: string;
  kind: 'reply' | 'waiting_on_client' | 'resolved' | 'closed';
  /** Staff reply body — included (truncated) when kind === 'reply'. */
  message?: string;
  portalUrl: string;
}): Promise<void> {
  const COPY: Record<typeof args.kind, { subject: string; lead: string; cta: string }> = {
    reply: {
      subject: `New reply on “${args.ticketTitle}”`,
      lead: 'The team replied on your ticket:',
      cta: 'View the conversation',
    },
    waiting_on_client: {
      subject: `Your input is needed on “${args.ticketTitle}”`,
      lead: 'The team needs something from you before this ticket can move forward.',
      cta: 'Reply in the portal',
    },
    resolved: {
      subject: `Resolved: “${args.ticketTitle}”`,
      lead: 'The team marked your ticket as resolved. If this isn’t sorted, just reply in the portal — that reopens it automatically.',
      cta: 'View the ticket',
    },
    closed: {
      subject: `Closed: “${args.ticketTitle}”`,
      lead: 'Your ticket has been closed. Need anything else? Open a new ticket any time.',
      cta: 'Open the portal',
    },
  };
  const c = COPY[args.kind];
  const snippet = args.message ? (args.message.length > 600 ? `${args.message.slice(0, 600)}…` : args.message) : null;

  const text = [
    `Hi ${args.contactName},`,
    '',
    c.lead,
    ...(snippet ? ['', `> ${snippet.replace(/\n/g, '\n> ')}`] : []),
    '',
    `${c.cta}: ${args.portalUrl}`,
    '',
    'Sign in with this email address if your session has expired.',
  ].join('\n');
  const html = wrap(`
    <h2 style="margin:0 0 12px 0;font-size:20px;color:#111;">${esc(c.subject)}</h2>
    <p style="margin:0 0 16px 0;color:#374151;">Hi ${esc(args.contactName)}, ${esc(c.lead)}</p>
    ${snippet ? `<blockquote style="margin:0 0 16px 0;padding:12px 16px;background:#f9fafb;border-left:3px solid #9333ea;border-radius:6px;color:#374151;white-space:pre-wrap;">${esc(snippet)}</blockquote>` : ''}
    ${button(args.portalUrl, c.cta)}
    <p style="margin:24px 0 0 0;font-size:12px;color:#9ca3af;">
      This is the ${esc(args.clientName)} portal. Sign in with this email address if your session has expired.
    </p>
  `);
  await send(args.senderUserId, args.to, c.subject, html, text);
}

// ---- HTML helpers ----

function wrap(body: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:560px;margin:32px auto;background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:32px;">
      ${body}
      <hr style="border:none;border-top:1px solid #f3f4f6;margin:32px 0 16px 0;">
      <p style="margin:0;font-size:11px;color:#9ca3af;">Allebrum portal · Sent on behalf of a teammate's connected Gmail account.</p>
    </div>
  </body></html>`;
}

function button(href: string, label: string): string {
  return `<table cellpadding="0" cellspacing="0" border="0"><tr><td>
    <a href="${esc(href)}" style="display:inline-block;background:#9333ea;color:#fff;font-weight:600;text-decoration:none;padding:11px 22px;border-radius:10px;font-size:14px;">${esc(label)}</a>
  </td></tr></table>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' :
    c === '<' ? '&lt;' :
    c === '>' ? '&gt;' :
    c === '"' ? '&quot;' :
    '&#39;'
  );
}
