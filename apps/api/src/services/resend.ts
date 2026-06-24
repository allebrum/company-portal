import { env } from '../env.js';

/**
 * Transactional-email transport over the Resend HTTP API.
 *
 * A single short-lived HTTPS request per message — the right model for the
 * Netlify Function runtime (no persistent SMTP socket). The caller (mail.ts)
 * decides whether Resend is configured; this module just performs the send and
 * throws on a non-2xx so mail.ts can log-and-noop without breaking the request.
 */
export async function sendViaResend(args: {
  to: string;
  subject: string;
  html: string;
  text: string;
  cc?: string | null;
  replyTo?: string | null;
}): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.MAIL_FROM;
  if (!apiKey || !from) throw new Error('resend_not_configured');

  const body: Record<string, unknown> = {
    from,
    to: [args.to],
    subject: args.subject,
    html: args.html,
    text: args.text,
  };
  if (args.cc) body.cc = args.cc.split(',').map((s) => s.trim()).filter(Boolean);
  const replyTo = args.replyTo ?? env.MAIL_REPLY_TO;
  if (replyTo) body.reply_to = replyTo;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`resend_send_failed status=${res.status} ${detail.slice(0, 300)}`);
  }
}
