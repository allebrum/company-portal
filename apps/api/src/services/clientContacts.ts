import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/client.js';
import { clientContacts, clients, type ClientContact } from '../db/schema.js';
import {
  issueToken,
  invalidateContactTokensFor,
  PORTAL_MAGIC_TTL_MS,
} from '../auth/tokens.js';
import { sendClientPortalInviteEmail } from './mail.js';
import { getSettings } from './settings.js';
import { env } from '../env.js';
import { HttpError } from '../middleware/errorHandler.js';
import { appendActivity } from './activity.js';
import { getUser } from './users.js';
import type { ContactRole, InviteContactInput, UpdateContactInput } from '@allebrum/shared';

/**
 * F23 client portal contacts service. Mirrors the staff invite pattern
 * but on the `client_contacts` table: insert row → issue portal-magic
 * token (subject = contact) → send email via the workspace's system
 * sender (F4 Gmail OAuth).
 *
 * Emails are case-folded on the way in so `Foo@x.com` and `foo@X.com`
 * land in the same `(client_id, email)` slot without needing the
 * `citext` extension on the DB.
 */

function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export async function listContacts(clientId: string): Promise<ClientContact[]> {
  return db
    .select()
    .from(clientContacts)
    .where(eq(clientContacts.clientId, clientId))
    .orderBy(asc(clientContacts.name));
}

export async function getContact(contactId: string): Promise<ClientContact | undefined> {
  const rows = await db
    .select()
    .from(clientContacts)
    .where(eq(clientContacts.id, contactId))
    .limit(1);
  return rows[0];
}

/**
 * Look up an active contact by (clientId, email) for the portal access
 * flow. The "request access" route uses this without leaking whether an
 * email/slug pair matches anything.
 */
export async function findContactByEmail(
  clientId: string,
  rawEmail: string,
): Promise<ClientContact | undefined> {
  const email = normaliseEmail(rawEmail);
  const rows = await db
    .select()
    .from(clientContacts)
    .where(and(eq(clientContacts.clientId, clientId), eq(clientContacts.email, email)))
    .limit(1);
  return rows[0];
}

/**
 * Create a new contact AND fire an invite email. The token is the
 * existing `portal-magic` kind (F23) with the contact as the subject —
 * single-use, 30-day TTL. Caller is staff; we use the workspace's
 * system sender Gmail account (F4) for the From: line. When no system
 * sender is connected, the email falls back to log-and-skip (the same
 * graceful degradation `sendInviteEmail` has).
 */
export async function inviteContact(args: {
  clientId: string;
  input: InviteContactInput;
  whoId: string;
}): Promise<{ contact: ClientContact; inviteUrl: string }> {
  const [client] = await db.select().from(clients).where(eq(clients.id, args.clientId)).limit(1);
  if (!client) throw new HttpError(404, 'client_not_found');
  if (!client.portalSlug) {
    throw new HttpError(400, 'portal_slug_required');
  }

  const email = normaliseEmail(args.input.email);

  // Upsert by (clientId, email). If the row exists, reuse it and let the
  // invite-resend path handle email + token freshness.
  const existing = await findContactByEmail(args.clientId, email);
  let contact: ClientContact;
  if (existing) {
    contact = existing;
  } else {
    const [row] = await db
      .insert(clientContacts)
      .values({
        clientId: args.clientId,
        name: args.input.name,
        email,
        role: args.input.role ?? 'viewer',
      })
      .returning();
    if (!row) throw new Error('insert_failed');
    contact = row;
  }

  // Single-use semantics: invalidate prior portal-magic tokens so the
  // newly issued one is the only live link in this contact's inbox.
  await invalidateContactTokensFor(contact.id, 'portal-magic');
  const { rawToken, expiresAt } = await issueToken(
    { kind: 'contact', contactId: contact.id },
    'portal-magic',
    PORTAL_MAGIC_TTL_MS,
  );
  // Portal routes use ?slug= query params (not /portal/[slug]/) so the
  // statically exported Next.js bundle doesn't need build-time slug
  // enumeration. See apps/web/src/app/portal/layout.tsx for the rationale.
  const inviteUrl =
    `${env.WEB_ORIGIN}/portal/access` +
    `?slug=${encodeURIComponent(client.portalSlug)}` +
    `&token=${encodeURIComponent(rawToken)}`;

  // Send via system-sender Gmail (F4). Log + no-op if not connected.
  const settings = await getSettings();
  const inviter = await getUser(args.whoId);
  try {
    await sendClientPortalInviteEmail({
      senderUserId: settings.systemSenderUserId ?? args.whoId,
      to: contact.email,
      contactName: contact.name,
      clientName: client.name,
      inviterName: inviter?.name ?? 'A teammate',
      portalUrl: inviteUrl,
      expiresAt,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[portal] failed to send invite email', e);
  }

  await appendActivity({
    whoId: args.whoId,
    kind: 'portal.invite',
    target: `${contact.email} → ${client.name} portal`,
  });

  return { contact, inviteUrl };
}

/**
 * Reissue the magic link. Same logic as `inviteContact` minus the row
 * insert — useful when a contact lost their email or the token expired.
 */
export async function resendContactInvite(args: {
  contactId: string;
  whoId: string;
}): Promise<{ inviteUrl: string }> {
  const contact = await getContact(args.contactId);
  if (!contact) throw new HttpError(404, 'contact_not_found');
  const [client] = await db.select().from(clients).where(eq(clients.id, contact.clientId)).limit(1);
  if (!client || !client.portalSlug) throw new HttpError(400, 'portal_slug_required');

  await invalidateContactTokensFor(contact.id, 'portal-magic');
  const { rawToken, expiresAt } = await issueToken(
    { kind: 'contact', contactId: contact.id },
    'portal-magic',
    PORTAL_MAGIC_TTL_MS,
  );
  const inviteUrl =
    `${env.WEB_ORIGIN}/portal/access` +
    `?slug=${encodeURIComponent(client.portalSlug)}` +
    `&token=${encodeURIComponent(rawToken)}`;

  const settings = await getSettings();
  const inviter = await getUser(args.whoId);
  try {
    await sendClientPortalInviteEmail({
      senderUserId: settings.systemSenderUserId ?? args.whoId,
      to: contact.email,
      contactName: contact.name,
      clientName: client.name,
      inviterName: inviter?.name ?? 'A teammate',
      portalUrl: inviteUrl,
      expiresAt,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[portal] failed to resend invite email', e);
  }

  await appendActivity({
    whoId: args.whoId,
    kind: 'portal.invite_resend',
    target: `${contact.email} → ${client.name} portal`,
  });

  return { inviteUrl };
}

export async function updateContact(
  contactId: string,
  patch: UpdateContactInput,
  whoId: string,
): Promise<ClientContact> {
  const upd: Record<string, unknown> = {};
  if (patch.name !== undefined) upd.name = patch.name;
  if (patch.role !== undefined) upd.role = patch.role satisfies ContactRole;
  if (Object.keys(upd).length === 0) {
    const existing = await getContact(contactId);
    if (!existing) throw new HttpError(404, 'contact_not_found');
    return existing;
  }
  const [row] = await db
    .update(clientContacts)
    .set(upd)
    .where(eq(clientContacts.id, contactId))
    .returning();
  if (!row) throw new HttpError(404, 'contact_not_found');
  await appendActivity({ whoId, kind: 'portal.contact_update', target: row.email });
  return row;
}

export async function deleteContact(contactId: string, whoId: string): Promise<void> {
  const existing = await getContact(contactId);
  if (!existing) throw new HttpError(404, 'contact_not_found');
  await db.delete(clientContacts).where(eq(clientContacts.id, contactId));
  await appendActivity({
    whoId,
    kind: 'portal.contact_delete',
    target: existing.email,
  });
}
