import { API_TOKEN_SCOPES, FULL_ACCESS_SCOPE, type ApiTokenScope } from '@allebrum/shared';

/**
 * Personal-access-token route policy (pure; no I/O so it's unit-testable).
 *
 * Bearer tokens flow through the SAME routers as the browser session (see
 * bearerAuth.ts): this table only decides which method+path pairs a token may
 * reach and which scope unlocks each one. It is default-deny — a route that
 * isn't listed here is 403 `token_route_not_allowed` for every token. RBAC
 * (`requirePermission` / `userCan`) still runs inside each route against the
 * owner's LIVE permissions, so a token can never exceed what its owner can do
 * right now.
 *
 * Adding a feature? Add its route here with a scope (or to SESSION_ONLY_ROUTES
 * with a reason). `tokenRouteCoverage.test.ts` fails until every route in
 * routes/*.ts is classified, so nothing silently becomes bot-reachable — or
 * silently stays unreachable.
 */

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
type Body = unknown;

export interface TokenRoute {
  method: HttpMethod;
  /** Express-style full path, e.g. `/api/projects/:id` (documentation + coverage test). */
  path: string;
  /** Matched against the full request path, no trailing slash. */
  pattern: RegExp;
  /** `null` = any valid token (e.g. whoami). */
  scope: ApiTokenScope | null;
  /**
   * Optional body-dependent override: some routes do two jobs (e.g. PATCH a
   * project's Notes vs. rename the project) and the web app gates them
   * differently, so the token scope follows the same split.
   */
  scopeFor?: (body: Body) => ApiTokenScope;
  /** JSON body fields a token may never send here (account-security fields). */
  sessionOnlyFields?: string[];
  note?: string;
}

const ID = '[A-Za-z0-9_-]{1,80}';
const KIND = '(?:client|clients|project|projects)';

function toPattern(path: string): RegExp {
  const src = path
    .split('/')
    .map((seg) => {
      if (seg === ':scopeKind') return KIND;
      if (seg.startsWith(':')) return ID;
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return new RegExp(`^${src}$`);
}

function r(method: HttpMethod, path: string, scope: ApiTokenScope | null, extra: Partial<TokenRoute> = {}): TokenRoute {
  return { method, path, pattern: toPattern(path), scope, ...extra };
}

/** A client/project PATCH that only touches Notes/Files is a notes edit (same rule as the web app). */
export function isNotesOnlyPatch(body: Body): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const keys = Object.keys(body);
  return keys.length > 0 && keys.every((k) => k === 'spaceBlocks' || k === 'spaceFiles');
}

const notesOr = (other: ApiTokenScope) => (body: Body): ApiTokenScope => (isNotesOnlyPatch(body) ? 'notes:write' : other);

/** Everything a token can reach. Anything not listed is 403 `token_route_not_allowed`. */
export const TOKEN_ROUTES: TokenRoute[] = [
  // ---- identity / discovery (any valid token)
  r('GET', '/api/api-tokens/current', null),
  r('GET', '/api/me/capabilities', null),
  r('GET', '/api/auth/me', 'read'),
  r('GET', '/api/bootstrap', 'read'),

  // ---- clients
  r('GET', '/api/clients', 'read'),
  r('POST', '/api/clients', 'clients:write'),
  r('PATCH', '/api/clients/:id', 'clients:write', {
    scopeFor: notesOr('clients:write'),
    note: 'A body with only spaceBlocks/spaceFiles needs notes:write instead (full Notes replace: edit/reorder/delete).',
  }),
  r('GET', '/api/clients/:id/contacts', 'read'),
  r('POST', '/api/clients/:id/contacts', 'clients:write'),
  r('PATCH', '/api/clients/:id/contacts/:contactId', 'clients:write'),
  r('DELETE', '/api/clients/:id/contacts/:contactId', 'clients:write'),
  r('POST', '/api/clients/:id/contacts/:contactId/resend', 'clients:write'),

  // ---- projects
  r('GET', '/api/projects', 'read'),
  r('POST', '/api/projects', 'projects:write'),
  r('PATCH', '/api/projects/:id', 'projects:write', {
    scopeFor: notesOr('projects:write'),
    note: 'A body with only spaceBlocks/spaceFiles needs notes:write instead (full Notes replace: edit/reorder/delete).',
  }),

  // ---- Space notes blocks
  r('GET', '/api/spaces/:scopeKind/:scopeId/blocks', 'read'),
  r('POST', '/api/spaces/:scopeKind/:scopeId/blocks', 'notes:write'),
  r('PATCH', '/api/spaces/:scopeKind/:scopeId/blocks/:blockId', 'notes:write'),
  r('DELETE', '/api/spaces/:scopeKind/:scopeId/blocks/:blockId', 'notes:write'),
  // ---- Space files
  r('POST', '/api/spaces/:scopeKind/:scopeId/files', 'files:write'),
  r('PATCH', '/api/spaces/:scopeKind/:scopeId/files/:fileId', 'files:write'),
  r('POST', '/api/spaces/:scopeKind/:scopeId/files/refresh-drive-names', 'files:write'),

  // ---- time
  r('GET', '/api/entries', 'read'),
  r('GET', '/api/entries/export.csv', 'read'),
  r('GET', '/api/entries/timer', 'read'),
  r('GET', '/api/entries/timers', 'read'),
  r('POST', '/api/entries', 'time:write'),
  r('PATCH', '/api/entries/:id', 'time:write'),
  r('POST', '/api/entries/timer/start', 'time:write'),
  r('POST', '/api/entries/timer/stop', 'time:write'),
  r('DELETE', '/api/entries/:id', 'time:manage'),
  r('POST', '/api/entries/submit', 'time:manage'),
  r('POST', '/api/entries/approve', 'time:manage'),
  r('POST', '/api/entries/reject', 'time:manage'),
  r('POST', '/api/entries/reopen', 'time:manage'),

  // ---- roadmap: goals / epics / milestones / to-dos
  r('GET', '/api/goals', 'read'),
  r('POST', '/api/goals', 'roadmap:write'),
  r('PATCH', '/api/goals/:id', 'roadmap:write'),
  r('PATCH', '/api/goals/:id/status', 'roadmap:write'),
  r('POST', '/api/goals/:id/resources', 'roadmap:write'),
  r('PATCH', '/api/goals/:id/resources/:rid', 'roadmap:write'),
  r('DELETE', '/api/goals/:id/resources/:rid', 'roadmap:write'),
  r('POST', '/api/goals/:id/resources/upload', 'files:write'),
  r('GET', '/api/epics', 'read'),
  r('POST', '/api/epics', 'roadmap:write'),
  r('PATCH', '/api/epics/:id', 'roadmap:write'),
  r('DELETE', '/api/epics/:id', 'roadmap:write'),
  r('GET', '/api/milestones', 'read'),
  r('POST', '/api/milestones', 'roadmap:write'),
  r('PATCH', '/api/milestones/:id', 'roadmap:write'),
  r('DELETE', '/api/milestones/:id', 'roadmap:write'),
  r('GET', '/api/todos', 'read'),
  r('POST', '/api/todos', 'roadmap:write'),
  r('PATCH', '/api/todos/:id', 'roadmap:write'),
  r('POST', '/api/todos/:id/toggle', 'roadmap:write'),
  r('DELETE', '/api/todos/:id', 'roadmap:write'),
  r('POST', '/api/todos/:id/files', 'files:write'),

  // ---- client-portal tickets (staff side)
  r('GET', '/api/tickets', 'read'),
  r('GET', '/api/tickets/:id', 'read'),
  r('PATCH', '/api/tickets/:id', 'tickets:write'),
  r('POST', '/api/tickets/:id/messages', 'tickets:write'),

  // ---- team / people / workspace admin
  r('GET', '/api/users', 'read'),
  r('POST', '/api/users', 'team:admin'),
  r('POST', '/api/users/:id/resend-invite', 'team:admin'),
  r('PATCH', '/api/users/:id', 'team:admin', {
    sessionOnlyFields: ['password', 'email'],
    note: 'Password and email changes are session-only (they control sign-in).',
  }),
  r('DELETE', '/api/users/:id', 'team:admin'),
  r('GET', '/api/rbac/permissions', 'read'),
  r('GET', '/api/rbac/groups', 'read'),
  r('GET', '/api/rbac/groups/:id/members', 'read'),
  r('GET', '/api/rbac/users/:id/groups', 'read'),
  r('GET', '/api/rbac/users/:id/overrides', 'read'),
  r('POST', '/api/rbac/groups', 'team:admin'),
  r('PATCH', '/api/rbac/groups/:id', 'team:admin'),
  r('DELETE', '/api/rbac/groups/:id', 'team:admin'),
  r('PUT', '/api/rbac/groups/:id/permissions', 'team:admin'),
  r('POST', '/api/rbac/groups/:id/users', 'team:admin'),
  r('DELETE', '/api/rbac/groups/:id/users/:userId', 'team:admin'),
  r('PUT', '/api/rbac/users/:id/groups', 'team:admin'),
  r('PUT', '/api/rbac/users/:id/overrides', 'team:admin'),
  r('GET', '/api/settings', 'read'),
  r('PATCH', '/api/settings', 'team:admin', {
    sessionOnlyFields: ['passwordLoginEnabled', 'googleLoginEnabled', 'allowedEmailDomains', 'systemSenderUserId'],
    note: 'Sign-in policy fields are session-only; branding/bookkeeper/terms fields are allowed.',
  }),
  r('POST', '/api/onboarding/sample-data', 'team:admin'),
  r('DELETE', '/api/onboarding/sample-data', 'team:admin'),
  r('GET', '/api/activity', 'read'),

  // ---- payroll & invoicing
  r('GET', '/api/pay-periods', 'read'),
  r('POST', '/api/pay-periods/generate', 'finance:write'),
  r('PATCH', '/api/pay-periods/:id', 'finance:write'),
  r('POST', '/api/pay-periods/:id/review', 'finance:write'),
  r('POST', '/api/pay-periods/:id/close', 'finance:write'),
  r('POST', '/api/pay-periods/:id/reopen', 'finance:write'),
  r('POST', '/api/pay-periods/recalculate', 'finance:write'),
  r('POST', '/api/pay-periods/:id/send-bookkeeper', 'finance:write'),
  r('GET', '/api/pay-config', 'read'),
  r('PATCH', '/api/pay-config', 'finance:write'),
  r('GET', '/api/invoicing/entries', 'read'),
  r('POST', '/api/invoicing/mark', 'finance:write'),
  r('POST', '/api/invoicing/unmark', 'finance:write'),
  r('POST', '/api/invoicing/quickbooks/invoice', 'finance:write'),

  // ---- integrations (status + Drive/QuickBooks data; connecting is session-only)
  r('GET', '/api/integrations', 'read'),
  r('GET', '/api/integrations/drive/status', 'read'),
  r('GET', '/api/integrations/drive/list', 'read'),
  r('GET', '/api/integrations/drive/file/:id/download', 'read'),
  r('GET', '/api/integrations/drive/file/:id/content', 'read'),
  r('POST', '/api/integrations/drive/folders', 'files:write'),
  r('POST', '/api/integrations/drive/upload', 'files:write'),
  r('PATCH', '/api/integrations/drive/file/:id', 'files:write'),
  r('DELETE', '/api/integrations/drive/file/:id', 'files:write'),
  r('POST', '/api/integrations/drive/reconcile', 'files:write'),
  r('GET', '/api/integrations/quickbooks/status', 'read'),
  r('GET', '/api/integrations/quickbooks/customers', 'read'),
  r('GET', '/api/integrations/quickbooks/items', 'read'),
  r('GET', '/api/integrations/gmail/status', 'read'),
  r('GET', '/api/integrations/gmail/connected-users', 'read'),

  // ---- upload-QR sessions (staff side)
  r('GET', '/api/upload/qr/sessions', 'read'),
  r('GET', '/api/upload/qr/sessions/:id/files', 'read'),
  r('POST', '/api/upload/qr/sessions', 'files:write'),
  r('POST', '/api/upload/qr/sessions/:id/revoke', 'files:write'),

  // ---- tools: QR codes, forms, websites
  r('GET', '/api/qr', 'read'),
  r('GET', '/api/qr/:id/scans', 'read'),
  r('GET', '/api/qr/:id/scans.csv', 'read'),
  r('GET', '/api/qr/:id/image.png', 'read'),
  r('POST', '/api/qr', 'tools:write'),
  r('PATCH', '/api/qr/:id', 'tools:write'),
  r('DELETE', '/api/qr/:id', 'tools:write'),
  r('GET', '/api/forms', 'read'),
  r('GET', '/api/forms/:id/submissions', 'read'),
  r('GET', '/api/forms/:id/submissions.csv', 'read'),
  r('GET', '/api/forms/:id/embed-snippet', 'read'),
  r('POST', '/api/forms', 'tools:write'),
  r('PATCH', '/api/forms/:id', 'tools:write'),
  r('DELETE', '/api/forms/:id', 'tools:write'),
  r('GET', '/api/websites', 'read'),
  r('POST', '/api/websites', 'tools:write'),
  r('PATCH', '/api/websites/:id', 'tools:write'),
  r('DELETE', '/api/websites/:id', 'tools:write'),
  r('GET', '/api/websites/:id/credentials', 'secrets:read'),
];

export interface SessionOnlyRoute {
  method: HttpMethod;
  path: string;
  reason: string;
}

const AUTH = 'Sign-in / account security — needs a real browser session.';
const TOKENS = 'Token management — a token can never mint, list or revoke tokens.';
const OAUTH = 'Connecting third-party accounts / credentials — browser OAuth flow, session only.';
const BILLING = 'Subscription billing — session only.';

/** Staff routes a token can never reach, with the reason (shown in capabilities + docs). */
export const SESSION_ONLY_ROUTES: SessionOnlyRoute[] = [
  ...(
    [
      ['GET', '/api/auth/csrf'],
      ['GET', '/api/auth/posthog-identity'],
      ['POST', '/api/auth/login'],
      ['POST', '/api/auth/logout'],
      ['POST', '/api/auth/switch-workspace'],
      ['POST', '/api/auth/forgot-password'],
      ['POST', '/api/auth/reset-password'],
      ['POST', '/api/auth/accept-invite'],
      ['GET', '/api/auth/google'],
      ['GET', '/api/auth/google/callback'],
      ['GET', '/api/auth/handoff'],
      ['GET', '/api/auth/2fa/challenge'],
      ['POST', '/api/auth/2fa/totp'],
      ['GET', '/api/auth/2fa/webauthn/options'],
      ['POST', '/api/auth/2fa/webauthn/verify'],
      ['GET', '/api/auth/2fa/status'],
      ['POST', '/api/auth/2fa/totp/setup'],
      ['POST', '/api/auth/2fa/totp/enable'],
      ['DELETE', '/api/auth/2fa/totp'],
      ['POST', '/api/auth/2fa/recovery/regenerate'],
      ['GET', '/api/auth/2fa/webauthn/register/options'],
      ['POST', '/api/auth/2fa/webauthn/register/verify'],
      ['PATCH', '/api/auth/2fa/webauthn/:id'],
      ['DELETE', '/api/auth/2fa/webauthn/:id'],
    ] as const
  ).map(([method, path]) => ({ method, path, reason: AUTH })),
  { method: 'GET', path: '/api/api-tokens', reason: TOKENS },
  { method: 'POST', path: '/api/api-tokens', reason: TOKENS },
  { method: 'DELETE', path: '/api/api-tokens/:id', reason: TOKENS },
  { method: 'POST', path: '/api/billing/manage-link', reason: BILLING },
  ...(
    [
      ['POST', '/api/integrations/:kind/connect'],
      ['POST', '/api/integrations/:kind/disconnect'],
      ['PATCH', '/api/integrations/:kind'],
      ['GET', '/api/integrations/drive/connect'],
      ['GET', '/api/integrations/drive/callback'],
      ['POST', '/api/integrations/drive/disconnect'],
      ['GET', '/api/integrations/quickbooks/connect'],
      ['GET', '/api/integrations/quickbooks/callback'],
      ['POST', '/api/integrations/quickbooks/disconnect'],
      ['GET', '/api/integrations/gmail/connect'],
      ['GET', '/api/integrations/gmail/callback'],
      ['POST', '/api/integrations/gmail/disconnect'],
    ] as const
  ).map(([method, path]) => ({ method, path, reason: OAUTH })),
];

/**
 * Routes that aren't staff-session routes at all (unauthenticated, HMAC, or a
 * different credential such as the client-portal contact session or a
 * capability URL). Tokens don't apply; listed so the coverage test knows
 * they were considered.
 */
export const NON_STAFF_ROUTE_PREFIXES = [
  '/api/health',
  '/api/auth/config',
  '/api/auth/methods',
  '/api/portal/',
  '/api/f/',
  '/api/q/',
  '/api/upload/qr/:token',
  '/api/provisioning/',
];

/** Every concrete scope a `full` token is treated as holding. */
export const ALL_CONCRETE_SCOPES: ApiTokenScope[] = API_TOKEN_SCOPES.filter((s) => s !== FULL_ACCESS_SCOPE);

/** Expand stored scopes into the effective set (`full` → every scope). */
export function effectiveScopes(scopes: readonly ApiTokenScope[]): ApiTokenScope[] {
  if (scopes.includes(FULL_ACCESS_SCOPE)) return [...API_TOKEN_SCOPES];
  return API_TOKEN_SCOPES.filter((s) => scopes.includes(s));
}

export function hasScope(scopes: readonly ApiTokenScope[], needed: ApiTokenScope): boolean {
  return scopes.includes(FULL_ACCESS_SCOPE) || scopes.includes(needed);
}

export type TokenRouteDecision =
  | { ok: true; route: TokenRoute }
  | {
      ok: false;
      status: 403;
      error: 'token_route_not_allowed' | 'insufficient_scope' | 'session_only_field';
      message: string;
      scope?: ApiTokenScope;
      fields?: string[];
    };

function normalize(method: string, path: string): { m: string; p: string } {
  return { m: method === 'HEAD' ? 'GET' : method, p: path.length > 1 ? path.replace(/\/+$/, '') : path };
}

/** Find the token route for a request (no scope check). */
export function findTokenRoute(method: string, path: string): TokenRoute | undefined {
  const { m, p } = normalize(method, path);
  return TOKEN_ROUTES.find((r) => r.method === m && r.pattern.test(p));
}

/** Pure policy check — exported for tests. HEAD is treated as GET. */
export function checkTokenRoute(
  method: string,
  path: string,
  scopes: readonly ApiTokenScope[],
  body?: Body,
): TokenRouteDecision {
  const route = findTokenRoute(method, path);
  if (!route) {
    return {
      ok: false,
      status: 403,
      error: 'token_route_not_allowed',
      message: 'This endpoint is not available to API tokens (session-only or unknown). See GET /api/me/capabilities.',
    };
  }
  const needed = route.scopeFor ? route.scopeFor(body) : route.scope;
  if (needed && !hasScope(scopes, needed)) {
    return {
      ok: false,
      status: 403,
      error: 'insufficient_scope',
      scope: needed,
      message: `This token is missing the "${needed}" scope. Create a token with that scope (or "full").`,
    };
  }
  if (route.sessionOnlyFields && body && typeof body === 'object' && !Array.isArray(body)) {
    const sent = route.sessionOnlyFields.filter((f) => Object.prototype.hasOwnProperty.call(body, f));
    if (sent.length > 0) {
      return {
        ok: false,
        status: 403,
        error: 'session_only_field',
        fields: sent,
        message: `These fields can only be changed from a signed-in browser session: ${sent.join(', ')}.`,
      };
    }
  }
  return { ok: true, route };
}

/** Parse `Authorization: Bearer <token>`; undefined when no bearer header. */
export function parseBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1] : '';
}
