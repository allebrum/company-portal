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
): Promise<void> {
  if (!senderUserId) {
    console.log(`[mail] no sender configured — would send to=${to} subject=${JSON.stringify(subject)}`);
    console.log(text);
    return;
  }
  try {
    await sendAsUser(senderUserId, { to, subject, html, text });
  } catch (e) {
    // 412 = sender hasn't connected Gmail yet. Log so the admin sees the
    // action URL and can hand-deliver while they finish the OAuth flow.
    if (e instanceof HttpError && e.status === 412) {
      console.log(`[mail] sender ${senderUserId} has not connected Gmail — would send to=${to} subject=${JSON.stringify(subject)}`);
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
