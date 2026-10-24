/**
 * Return-to URLs for the login redirect. When the session ends while a page
 * is open, AuthGate sends the user to `/login?next=<where they were>`; after
 * signing in, the login page sends them back. `next` comes from the URL, so
 * only same-origin app paths are accepted (no `//evil.com`, no schemes).
 */

/** Pages that must never be a return target (they'd bounce straight back). */
const NEVER_RETURN_TO = ['/login', '/signup', '/forgot-password', '/reset-password', '/accept-invite'];

export function safeReturnTo(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2000) return null;
  // Same-origin absolute path only. Rejects "//host", "/\host" (browsers
  // treat backslash as slash), schemes, and control characters.
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\\]/.test(raw)) return null;
  const path = raw.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  if (NEVER_RETURN_TO.includes(path)) return null;
  if (path === '/') return null; // root just redirects to the dashboard anyway
  return raw;
}

/** `/login`, carrying where to come back to (and why) when there is one. */
export function loginUrl(currentPathWithQuery: string | null, opts: { expired?: boolean } = {}): string {
  const params = new URLSearchParams();
  const next = safeReturnTo(currentPathWithQuery);
  if (next) params.set('next', next);
  if (opts.expired) params.set('expired', '1');
  const q = params.toString();
  return q ? `/login?${q}` : '/login';
}
