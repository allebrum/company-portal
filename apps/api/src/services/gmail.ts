import { google, type gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/client.js';
import { oauthTokens, users } from '../db/schema.js';
import { env, gmailRedirectUrl, gmailOAuthConfigured } from '../env.js';
import { HttpError } from '../middleware/errorHandler.js';

const PROVIDER = 'google_gmail';
export const GMAIL_SCOPES = ['https://www.googleapis.com/auth/gmail.send'];

export function gmailConfigured(): boolean {
  return gmailOAuthConfigured;
}

function oauthClient(): OAuth2Client {
  if (!gmailOAuthConfigured) throw new Error('gmail_oauth_not_configured');
  return new OAuth2Client(env.GOOGLE_OAUTH_CLIENT_ID, env.GOOGLE_OAUTH_CLIENT_SECRET, gmailRedirectUrl);
}

export function buildGmailConsentUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: GMAIL_SCOPES,
    state,
  });
}

export async function exchangeGmailCode(code: string) {
  const { tokens } = await oauthClient().getToken(code);
  return tokens;
}

/**
 * Persist a fresh Gmail token set for a user. Unlike Drive (which keeps a
 * single workspace-wide row), Gmail is per-user — keyed by (userId,
 * 'google_gmail') so any teammate can connect their own mailbox.
 *
 * Google omits `refresh_token` on a re-consent if the user already granted
 * the app once. Preserve the previously stored one in that case.
 */
export async function saveGmailToken(
  userId: string,
  tokens: { access_token?: string | null; refresh_token?: string | null; expiry_date?: number | null },
): Promise<void> {
  await db
    .insert(oauthTokens)
    .values({
      userId,
      provider: PROVIDER,
      scopes: GMAIL_SCOPES,
      accessToken: tokens.access_token ?? null,
      refreshToken: tokens.refresh_token ?? null,
      expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    })
    .onConflictDoUpdate({
      target: [oauthTokens.userId, oauthTokens.provider],
      set: {
        scopes: GMAIL_SCOPES,
        accessToken: tokens.access_token ?? null,
        ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
        expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        updatedAt: new Date().toISOString(),
      },
    });
}

async function getStoredToken(userId: string) {
  const rows = await db
    .select()
    .from(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, PROVIDER)))
    .limit(1);
  return rows[0];
}

export async function getGmailStatusForUser(userId: string) {
  const t = await getStoredToken(userId);
  return {
    configured: gmailOAuthConfigured,
    connected: !!t?.refreshToken,
    lastConnectedAt: t?.updatedAt ?? null,
  };
}

export async function disconnectGmail(userId: string): Promise<void> {
  await db
    .delete(oauthTokens)
    .where(and(eq(oauthTokens.userId, userId), eq(oauthTokens.provider, PROVIDER)));
}

/**
 * Returns user IDs of every teammate currently holding a Gmail refresh
 * token. Drives the "system sender" dropdown in Settings.
 */
export async function listGmailConnectedUserIds(): Promise<string[]> {
  const rows = await db
    .select({ userId: oauthTokens.userId })
    .from(oauthTokens)
    .where(eq(oauthTokens.provider, PROVIDER));
  return rows.map((r) => r.userId);
}

/**
 * Builds an authenticated Gmail v1 client for the given user. Auto-refresh
 * is wired through the 'tokens' event so refreshed access tokens get
 * persisted back to oauth_tokens instead of being thrown away each call.
 */
async function getGmailClient(userId: string): Promise<gmail_v1.Gmail> {
  const token = await getStoredToken(userId);
  if (!token?.refreshToken) throw new HttpError(412, 'gmail_not_connected');
  const client = oauthClient();
  client.setCredentials({
    refresh_token: token.refreshToken,
    access_token: token.accessToken ?? undefined,
    expiry_date: token.expiry ? new Date(token.expiry).getTime() : undefined,
  });
  // Persist refreshed credentials. The library emits this event when it
  // auto-refreshes an expired access token using the refresh_token.
  client.on('tokens', (refreshed) => {
    void saveGmailToken(userId, {
      access_token: refreshed.access_token ?? token.accessToken,
      // Google rarely re-issues refresh_token on a refresh — keep the old.
      refresh_token: refreshed.refresh_token ?? token.refreshToken,
      expiry_date: refreshed.expiry_date ?? null,
    });
  });
  return google.gmail({ version: 'v1', auth: client });
}

/**
 * Send a transactional email through the given user's Gmail account. The
 * `From` header derives from the user's profile in our DB; Gmail will
 * rewrite it to the authenticated mailbox if you try to spoof, so this
 * mostly drives the display name in the recipient's inbox.
 *
 * Throws HttpError(412, 'gmail_not_connected') if the sender hasn't
 * connected — callers (mail.ts) use that to log + bail without failing
 * the surrounding request.
 */
export async function sendAsUser(
  senderUserId: string,
  args: { to: string; cc?: string | null; subject: string; html: string; text: string },
): Promise<void> {
  const senderRows = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, senderUserId))
    .limit(1);
  const sender = senderRows[0];
  if (!sender) throw new HttpError(412, 'gmail_not_connected');

  const gmail = await getGmailClient(senderUserId);
  const raw = buildRfc822({
    from: `${sender.name} <${sender.email}>`,
    to: args.to,
    cc: args.cc ?? undefined,
    subject: args.subject,
    html: args.html,
    text: args.text,
  });
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw },
  });
}

/**
 * Build a base64url-encoded RFC 822 MIME message with a multipart/alternative
 * body (text + html). Gmail's send endpoint accepts a single `raw` field —
 * we hand-assemble the headers and parts to avoid pulling in a MIME builder.
 */
function buildRfc822(args: {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  html: string;
  text: string;
}): string {
  const boundary = `=_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}=`;
  const headers = [
    `From: ${args.from}`,
    `To: ${args.to}`,
    // Comma-separated list of additional recipients (bookkeeper team CC).
    ...(args.cc ? [`Cc: ${args.cc}`] : []),
    `Subject: ${encodeHeader(args.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    args.text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    args.html,
    '',
    `--${boundary}--`,
    '',
  ];
  const message = headers.join('\r\n') + '\r\n\r\n' + body.join('\r\n');
  // Gmail expects URL-safe base64 (RFC 4648 §5).
  return Buffer.from(message, 'utf8').toString('base64url');
}

/**
 * RFC 2047 "encoded-word" for any header value that contains non-ASCII —
 * keeps emoji and accented characters from being mangled in transit.
 */
function encodeHeader(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}
