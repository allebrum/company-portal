import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NON_STAFF_ROUTE_PREFIXES, SESSION_ONLY_ROUTES, TOKEN_ROUTES } from '../tokenPolicy.js';

/**
 * Drift guard: statically read every router in routes/*.ts and require each
 * route to be classified as token-reachable (TOKEN_ROUTES, with a scope),
 * session-only (SESSION_ONLY_ROUTES, with a reason), or non-staff (public /
 * portal / HMAC). A new feature therefore can't ship without deciding whether
 * bots may use it — and with a scope tag it's automatically bot-accessible.
 */
const routesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../routes');

function discoverRoutes(): { method: string; path: string }[] {
  const index = readFileSync(path.join(routesDir, 'index.ts'), 'utf8');
  const routerFile = new Map<string, string>();
  for (const [, names, file] of index.matchAll(/import \{([^}]*)\} from '\.\/(\w+)\.js'/g)) {
    for (const n of names!.split(',')) routerFile.set(n.trim(), file!);
  }
  const out: { method: string; path: string }[] = [];
  for (const [, prefix, routerName] of index.matchAll(/apiRouter\.use\('([^']+)',\s*(\w+)\)/g)) {
    const file = routerFile.get(routerName!);
    assert.ok(file, `router ${routerName} import not found`);
    const src = readFileSync(path.join(routesDir, `${file}.ts`), 'utf8');
    const re = new RegExp(`${routerName}\\.(get|post|patch|put|delete)\\(\\s*'([^']+)'`, 'g');
    for (const [, method, p] of src.matchAll(re)) {
      out.push({ method: method!.toUpperCase(), path: `/api${prefix}${p === '/' ? '' : p}` });
    }
  }
  return out;
}

const routes = discoverRoutes();

test('route discovery finds the app routers', () => {
  assert.ok(routes.length > 150, `only found ${routes.length} routes`);
  assert.ok(routes.some((r) => r.method === 'POST' && r.path === '/api/projects'));
});

test('every route is classified for API tokens', () => {
  const token = new Set(TOKEN_ROUTES.map((r) => `${r.method} ${r.path}`));
  const session = new Set(SESSION_ONLY_ROUTES.map((r) => `${r.method} ${r.path}`));
  const unclassified = routes.filter(
    (r) =>
      !token.has(`${r.method} ${r.path}`) &&
      !session.has(`${r.method} ${r.path}`) &&
      !NON_STAFF_ROUTE_PREFIXES.some((p) => r.path === p || r.path.startsWith(p)),
  );
  assert.deepEqual(unclassified, [], 'add these to TOKEN_ROUTES (with a scope) or SESSION_ONLY_ROUTES');
});

test('every token / session-only entry points at a real route', () => {
  const real = new Set(routes.map((r) => `${r.method} ${r.path}`));
  for (const r of [...TOKEN_ROUTES, ...SESSION_ONLY_ROUTES]) {
    assert.ok(real.has(`${r.method} ${r.path}`), `stale policy entry: ${r.method} ${r.path}`);
  }
});
