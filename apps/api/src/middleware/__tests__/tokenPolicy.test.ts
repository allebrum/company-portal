import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_TOKEN_SCOPES, type ApiTokenScope } from '@allebrum/shared';
import {
  checkTokenRoute,
  effectiveScopes,
  isNotesOnlyPatch,
  parseBearer,
  SESSION_ONLY_ROUTES,
  TOKEN_ROUTES,
} from '../tokenPolicy.js';

const ALL = API_TOKEN_SCOPES.filter((s) => s !== 'full');
const C = '2b48b44a-1ffa-466b-8050-51d8c6ff8204';

function expectScope(m: string, p: string, scope: ApiTokenScope, body?: unknown) {
  assert.equal(checkTokenRoute(m, p, [scope], body).ok, true, `${m} ${p} with ${scope}`);
  assert.equal(checkTokenRoute(m, p, ['full'], body).ok, true, `${m} ${p} with full`);
  const others = ALL.filter((s) => s !== scope);
  const denied = checkTokenRoute(m, p, others, body);
  assert.equal(denied.ok, false, `${m} ${p} without ${scope}`);
  if (!denied.ok) {
    assert.equal(denied.error, 'insufficient_scope');
    assert.equal(denied.scope, scope, 'error names the missing scope');
    assert.match(denied.message, new RegExp(scope));
  }
}

test('parseBearer: absent, malformed, and well-formed headers', () => {
  assert.equal(parseBearer(undefined), undefined);
  assert.equal(parseBearer('Basic abc'), '');
  assert.equal(parseBearer('Bearer'), '');
  assert.equal(parseBearer('Bearer hpat_x'), 'hpat_x');
  assert.equal(parseBearer('bearer   hpat_x  '), 'hpat_x');
  assert.equal(parseBearer('Bearer a b'), '');
});

test('legacy scopes (read, notes:write, time:write) keep their original reach', () => {
  const legacy: [string, string, ApiTokenScope][] = [
    ['GET', '/api/clients', 'read'],
    ['GET', '/api/projects/', 'read'],
    ['GET', `/api/spaces/clients/${C}/blocks`, 'read'],
    ['HEAD', '/api/entries', 'read'],
    ['GET', '/api/entries/timer', 'read'],
    ['GET', '/api/entries/timers', 'read'],
    ['POST', '/api/entries', 'time:write'],
    ['PATCH', `/api/entries/${C}`, 'time:write'],
    ['POST', '/api/entries/timer/start', 'time:write'],
    ['POST', '/api/entries/timer/stop', 'time:write'],
    ['POST', `/api/spaces/project/${C}/blocks`, 'notes:write'],
  ];
  for (const [m, p, scope] of legacy) expectScope(m, p, scope);
});

test('new scopes unlock their resource areas', () => {
  const cases: [string, string, ApiTokenScope, unknown?][] = [
    // the trigger: creating projects + clients
    ['POST', '/api/projects', 'projects:write', { name: 'X', clientId: C }],
    ['PATCH', `/api/projects/${C}`, 'projects:write', { name: 'Renamed' }],
    ['POST', '/api/clients', 'clients:write', { name: 'Acme' }],
    ['PATCH', `/api/clients/${C}`, 'clients:write', { name: 'Acme 2' }],
    ['POST', `/api/clients/${C}/contacts`, 'clients:write'],
    // notes: edit / delete / reorder
    ['PATCH', `/api/spaces/clients/${C}/blocks/abc-123`, 'notes:write'],
    ['DELETE', `/api/spaces/project/${C}/blocks/abc_123`, 'notes:write'],
    ['PATCH', `/api/projects/${C}`, 'notes:write', { spaceBlocks: [] }],
    ['PATCH', `/api/clients/${C}`, 'notes:write', { spaceBlocks: [], spaceFiles: [] }],
    // time management
    ['DELETE', `/api/entries/${C}`, 'time:manage'],
    ['POST', '/api/entries/submit', 'time:manage'],
    ['POST', '/api/entries/approve', 'time:manage'],
    ['POST', '/api/entries/reject', 'time:manage'],
    ['POST', '/api/entries/reopen', 'time:manage'],
    // roadmap / tasks
    ['POST', '/api/goals', 'roadmap:write'],
    ['PATCH', `/api/goals/${C}/status`, 'roadmap:write'],
    ['DELETE', `/api/milestones/${C}`, 'roadmap:write'],
    ['POST', '/api/epics', 'roadmap:write'],
    ['POST', '/api/todos', 'roadmap:write'],
    ['POST', `/api/todos/${C}/toggle`, 'roadmap:write'],
    ['DELETE', `/api/todos/${C}`, 'roadmap:write'],
    // files
    ['POST', `/api/todos/${C}/files`, 'files:write'],
    ['POST', `/api/spaces/clients/${C}/files`, 'files:write'],
    ['POST', '/api/integrations/drive/upload', 'files:write'],
    // tickets / tools / finance / team / secrets
    ['POST', `/api/tickets/${C}/messages`, 'tickets:write'],
    ['POST', '/api/qr', 'tools:write'],
    ['DELETE', `/api/forms/${C}`, 'tools:write'],
    ['POST', `/api/pay-periods/${C}/close`, 'finance:write'],
    ['POST', '/api/invoicing/mark', 'finance:write'],
    ['POST', '/api/users', 'team:admin'],
    ['PUT', `/api/rbac/users/${C}/groups`, 'team:admin'],
    ['PATCH', '/api/settings', 'team:admin', { portalName: 'Hoppa' }],
    ['GET', `/api/websites/${C}/credentials`, 'secrets:read'],
    // broader read
    ['GET', '/api/users', 'read'],
    ['GET', '/api/goals', 'read'],
    ['GET', '/api/settings', 'read'],
    ['GET', '/api/auth/me', 'read'],
  ];
  for (const [m, p, scope, body] of cases) expectScope(m, p, scope, body);
});

test('a notes-only PATCH does not let notes:write rename a project', () => {
  assert.equal(isNotesOnlyPatch({ spaceBlocks: [] }), true);
  assert.equal(isNotesOnlyPatch({ spaceBlocks: [], name: 'x' }), false);
  assert.equal(isNotesOnlyPatch({}), false);
  assert.equal(isNotesOnlyPatch(undefined), false);
  const d = checkTokenRoute('PATCH', `/api/projects/${C}`, ['notes:write'], { spaceBlocks: [], name: 'sneaky' });
  assert.equal(d.ok, false);
  assert.equal(!d.ok && d.scope, 'projects:write');
});

test('discovery routes need any valid token, no scope', () => {
  assert.equal(checkTokenRoute('GET', '/api/api-tokens/current', []).ok, true);
  assert.equal(checkTokenRoute('GET', '/api/me/capabilities', []).ok, true);
});

test('full access = every scope', () => {
  assert.deepEqual(effectiveScopes(['full']), [...API_TOKEN_SCOPES]);
  assert.deepEqual(effectiveScopes(['time:write', 'read']), ['read', 'time:write']);
  for (const r of TOKEN_ROUTES) {
    const path = r.path.replace(':scopeKind', 'clients').replace(/:[A-Za-z]+/g, C);
    assert.equal(checkTokenRoute(r.method, path, ['full']).ok, true, `${r.method} ${r.path}`);
  }
});

test('session-only routes are denied even with full access', () => {
  for (const r of SESSION_ONLY_ROUTES) {
    const path = r.path.replace(/:[A-Za-z]+/g, 'gmail');
    const d = checkTokenRoute(r.method, path, ['full', ...ALL]);
    assert.equal(d.ok, false, `${r.method} ${r.path}`);
    assert.equal(!d.ok && d.error, 'token_route_not_allowed', `${r.method} ${r.path}`);
  }
});

test('security fields are session-only even with full access', () => {
  const pw = checkTokenRoute('PATCH', `/api/users/${C}`, ['full'], { password: 'hunter22hunter' });
  assert.equal(pw.ok, false);
  assert.equal(!pw.ok && pw.error, 'session_only_field');
  assert.deepEqual(!pw.ok && pw.fields, ['password']);
  const em = checkTokenRoute('PATCH', `/api/users/${C}`, ['team:admin'], { name: 'x', email: 'a@b.co' });
  assert.equal(!em.ok && em.error, 'session_only_field');
  assert.equal(checkTokenRoute('PATCH', `/api/users/${C}`, ['team:admin'], { name: 'x' }).ok, true);
  const st = checkTokenRoute('PATCH', '/api/settings', ['full'], { passwordLoginEnabled: false });
  assert.equal(!st.ok && st.error, 'session_only_field');
  assert.equal(checkTokenRoute('PATCH', '/api/settings', ['full'], { brandPrimaryColor: '#112233' }).ok, true);
});

test('everything unknown or session-only is denied with every scope (default-deny)', () => {
  const denied: [string, string][] = [
    ['GET', '/api/api-tokens'],
    ['POST', '/api/api-tokens'],
    ['DELETE', `/api/api-tokens/${C}`],
    ['POST', '/api/auth/logout'],
    ['POST', '/api/auth/login'],
    ['POST', '/api/auth/2fa/totp/setup'],
    ['DELETE', '/api/auth/2fa/totp'],
    ['POST', '/api/auth/switch-workspace'],
    ['POST', '/api/billing/manage-link'],
    ['POST', '/api/integrations/gmail/disconnect'],
    ['GET', '/api/integrations/drive/connect'],
    ['PATCH', '/api/integrations/quickbooks'],
    ['POST', `/api/spaces/widgets/${C}/blocks`],
    ['GET', '/api/Clients'],
    ['GET', '/api/entries/../users'],
    ['PUT', '/api/entries'],
    ['GET', '/api/portal/me'],
    ['POST', '/api/provisioning/account'],
    ['PATCH', `/api/entries/${C}%2F..`],
  ];
  for (const [m, p] of denied) {
    const d = checkTokenRoute(m, p, ['full', ...ALL]);
    assert.equal(d.ok, false, `${m} ${p}`);
    assert.equal(!d.ok && d.error, 'token_route_not_allowed', `${m} ${p}`);
  }
});

test('no route is both token-reachable and session-only', () => {
  const key = (m: string, p: string) => `${m} ${p}`;
  const tokenKeys = new Set(TOKEN_ROUTES.map((r) => key(r.method, r.path)));
  for (const s of SESSION_ONLY_ROUTES) assert.equal(tokenKeys.has(key(s.method, s.path)), false, key(s.method, s.path));
  assert.equal(tokenKeys.size, TOKEN_ROUTES.length, 'no duplicate token routes');
});
