/**
 * Portal magic-link exchange — pure decision logic (no DB imports) so the
 * ordering guarantees are unit-testable.
 *
 * Ordering rule: every check that can fail WITHOUT the caller's fault
 * (expired, unpublished portal, slug mismatch) runs BEFORE the token is
 * consumed. A failed attempt therefore never burns a link that would have
 * worked later (e.g. once staff publish the portal), and a token is only
 * claimed at the very end, atomically, by `consume`.
 *
 * Error codes are deliberately about the TOKEN, never about an email
 * address, so nothing here helps enumerate contacts:
 *   - invalid_token       unknown token, wrong kind, or slug/contact mismatch
 *   - token_used          already used, or superseded by a newer link
 *   - token_expired       past its TTL
 *   - portal_unpublished  the portal this token belongs to isn't live
 */

export type PortalExchangeError = 'invalid_token' | 'token_used' | 'token_expired' | 'portal_unpublished';

export type InspectedToken =
  | { state: 'not_found' }
  | { state: 'used' | 'expired' | 'valid'; contactId: string | null };

export type PortalExchangeDeps = {
  inspect: (rawToken: string) => Promise<InspectedToken>;
  loadContact: (contactId: string) => Promise<{ id: string; clientId: string } | null>;
  loadClient: (clientId: string) => Promise<{ id: string; slug: string | null; publishedAt: string | null } | null>;
  /** Atomic single-use claim. Returns false if someone else claimed it first. */
  consume: (rawToken: string) => Promise<boolean>;
};

export type PortalExchangeResult =
  | { ok: true; contactId: string; clientId: string; slug: string }
  | { ok: false; error: PortalExchangeError };

/** Classify a stored token row. `now` injectable for tests. */
export function classifyTokenRow(
  row: { usedAt: string | null; expiresAt: string } | null | undefined,
  now: number = Date.now(),
): 'not_found' | 'used' | 'expired' | 'valid' {
  if (!row) return 'not_found';
  if (row.usedAt) return 'used';
  if (new Date(row.expiresAt).getTime() < now) return 'expired';
  return 'valid';
}

export async function exchangePortalToken(
  input: { slug: string; token: string },
  deps: PortalExchangeDeps,
): Promise<PortalExchangeResult> {
  const slug = input.slug.toLowerCase().trim();
  const t = await deps.inspect(input.token);
  if (t.state === 'not_found' || !t.contactId) return { ok: false, error: 'invalid_token' };

  const contact = await deps.loadContact(t.contactId);
  if (!contact) return { ok: false, error: 'invalid_token' };
  const client = await deps.loadClient(contact.clientId);
  // A token minted for client A must never work at client B's slug; we
  // don't say which client it belongs to.
  if (!client || !client.slug || client.slug !== slug) return { ok: false, error: 'invalid_token' };

  if (t.state === 'used') return { ok: false, error: 'token_used' };
  if (t.state === 'expired') return { ok: false, error: 'token_expired' };
  if (!client.publishedAt) return { ok: false, error: 'portal_unpublished' };

  const claimed = await deps.consume(input.token);
  if (!claimed) return { ok: false, error: 'token_used' };
  return { ok: true, contactId: contact.id, clientId: client.id, slug: client.slug };
}
