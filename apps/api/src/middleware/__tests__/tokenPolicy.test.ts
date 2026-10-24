import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkTokenRoute, parseBearer } from '../tokenPolicy.js';

const ALL = ['read', 'notes:write', 'time:write'] as const;
const C = '2b48b44a-1ffa-466b-8050-51d8c6ff8204';

test('parseBearer: absent, malformed, and well-formed headers', () => {
  assert.equal(parseBearer(undefined), undefined);
  assert.equal(parseBearer('Basic abc'), '');
  assert.equal(parseBearer('Bearer'), '');
  assert.equal(parseBearer('Bearer hpat_x'), 'hpat_x');
  assert.equal(parseBearer('bearer   hpat_x  '), 'hpat_x');
  assert.equal(parseBearer('Bearer a b'), '');
});

test('allow-listed routes pass with the right scope', () => {
  const ok: [string, string, (typeof ALL)[number]][] = [
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
  for (const [m, p, scope] of ok) {
    assert.deepEqual(checkTokenRoute(m, p, [scope]), { ok: true }, `${m} ${p}`);
    const others = ALL.filter((s) => s !== scope);
    const denied = checkTokenRoute(m, p, others);
    assert.equal(denied.ok, false, `${m} ${p} without ${scope}`);
    assert.equal(!denied.ok && denied.error, 'insufficient_scope');
  }
});

test('whoami needs any valid token, no scope', () => {
  assert.deepEqual(checkTokenRoute('GET', '/api/api-tokens/current', []), { ok: true });
});

test('everything else is denied even with every scope (default-deny)', () => {
  const denied: [string, string][] = [
    ['GET', '/api/api-tokens'],
    ['POST', '/api/api-tokens'],
    ['DELETE', `/api/api-tokens/${C}`],
    ['PATCH', `/api/clients/${C}`],
    ['PATCH', `/api/projects/${C}`],
    ['POST', '/api/clients'],
    ['DELETE', `/api/entries/${C}`],
    ['POST', '/api/entries/submit'],
    ['POST', '/api/entries/approve'],
    ['GET', '/api/entries/export.csv'],
    ['GET', '/api/users'],
    ['GET', '/api/auth/me'],
    ['POST', '/api/auth/logout'],
    ['GET', '/api/settings'],
    ['POST', `/api/spaces/clients/${C}/files`],
    ['POST', `/api/spaces/widgets/${C}/blocks`],
    ['GET', '/api/Clients'],
    ['GET', '/api/entries/../users'],
    ['PUT', '/api/entries'],
  ];
  for (const [m, p] of denied) {
    const d = checkTokenRoute(m, p, [...ALL]);
    assert.equal(d.ok, false, `${m} ${p}`);
    assert.equal(!d.ok && d.error, 'token_route_not_allowed', `${m} ${p}`);
  }
});
