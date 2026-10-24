import type { ApiTokenScope } from '@allebrum/shared';

/**
 * Personal-access-token route policy (pure; no I/O so it's unit-testable).
 * Default-deny: a token can only reach the method+path pairs listed here,
 * and only with the matching scope. RBAC still applies on top — a token can
 * never do more than its user could in the browser.
 */
export interface TokenRoute {
  method: 'GET' | 'POST' | 'PATCH';
  /** Matched against the full path (e.g. `/api/entries`), no trailing slash. */
  pattern: RegExp;
  /** `null` = any valid token (e.g. whoami). */
  scope: ApiTokenScope | null;
}

const ID = '[A-Za-z0-9-]{1,80}';
const KIND = '(?:client|clients|project|projects)';

/** Everything a token can reach. Anything not listed is 403 `token_route_not_allowed`. */
export const TOKEN_ROUTES: TokenRoute[] = [
  { method: 'GET', pattern: /^\/api\/api-tokens\/current$/, scope: null },
  // read
  { method: 'GET', pattern: /^\/api\/clients$/, scope: 'read' },
  { method: 'GET', pattern: /^\/api\/projects$/, scope: 'read' },
  { method: 'GET', pattern: new RegExp(`^/api/spaces/${KIND}/${ID}/blocks$`), scope: 'read' },
  { method: 'GET', pattern: /^\/api\/entries$/, scope: 'read' },
  { method: 'GET', pattern: /^\/api\/entries\/timers?$/, scope: 'read' },
  // time:write
  { method: 'POST', pattern: /^\/api\/entries$/, scope: 'time:write' },
  { method: 'PATCH', pattern: new RegExp(`^/api/entries/${ID}$`), scope: 'time:write' },
  { method: 'POST', pattern: /^\/api\/entries\/timer\/(?:start|stop)$/, scope: 'time:write' },
  // notes:write (append-only)
  { method: 'POST', pattern: new RegExp(`^/api/spaces/${KIND}/${ID}/blocks$`), scope: 'notes:write' },
];

export type TokenRouteDecision = { ok: true } | { ok: false; status: 403; error: 'token_route_not_allowed' | 'insufficient_scope'; scope?: ApiTokenScope };

/** Pure policy check — exported for tests. HEAD is treated as GET. */
export function checkTokenRoute(method: string, path: string, scopes: readonly ApiTokenScope[]): TokenRouteDecision {
  const m = method === 'HEAD' ? 'GET' : method;
  const p = path.length > 1 ? path.replace(/\/+$/, '') : path;
  const route = TOKEN_ROUTES.find((r) => r.method === m && r.pattern.test(p));
  if (!route) return { ok: false, status: 403, error: 'token_route_not_allowed' };
  if (route.scope && !scopes.includes(route.scope)) {
    return { ok: false, status: 403, error: 'insufficient_scope', scope: route.scope };
  }
  return { ok: true };
}

/** Parse `Authorization: Bearer <token>`; undefined when no bearer header. */
export function parseBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1] : '';
}

