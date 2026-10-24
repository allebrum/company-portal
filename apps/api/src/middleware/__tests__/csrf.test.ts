import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { csrfProtection } from '../csrf.js';

// CSRF middleware contract: cross-site form POSTs riding the SameSite=None
// session cookie must be rejected, while the SPA (Origin/Sec-Fetch-Site),
// the self-host single-origin deploy, token-echoing scripts, and the
// deliberately cookieless public surfaces all keep working.

const WEB_ORIGIN = 'https://rc.allebrum.com';

const guard = csrfProtection({
  allowedOrigins: [WEB_ORIGIN],
  exemptPrefixes: ['/api/provisioning', '/api/f', '/api/q'],
  exemptPatterns: [/^\/api\/upload\/qr\/(?!sessions\b)[^/]+\/files$/],
});

function run(input: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
  session?: Record<string, unknown>;
}) {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) headers[k.toLowerCase()] = v;
  const req = {
    method: input.method ?? 'POST',
    path: input.path ?? '/api/todos',
    protocol: 'https',
    session: input.session,
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  let status: number | undefined;
  let allowed = false;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  } as unknown as Response;
  guard(req, res, () => {
    allowed = true;
  });
  return { allowed, status };
}

test('safe methods pass with no headers at all', () => {
  assert.equal(run({ method: 'GET', headers: {} }).allowed, true);
  assert.equal(run({ method: 'OPTIONS', headers: {} }).allowed, true);
});

test('cross-site form POST (foreign Origin) is blocked with 403', () => {
  const r = run({ headers: { origin: 'https://evil.example' } });
  assert.equal(r.allowed, false);
  assert.equal(r.status, 403);
});

test('POST with no provenance headers is blocked', () => {
  const r = run({ headers: {} });
  assert.equal(r.allowed, false);
  assert.equal(r.status, 403);
});

test('SPA POST from WEB_ORIGIN passes', () => {
  assert.equal(run({ headers: { origin: WEB_ORIGIN } }).allowed, true);
});

test('same-origin POST passes via Sec-Fetch-Site even when Origin is "null"', () => {
  // Referrer-Policy can degrade a same-origin POST's Origin to the literal
  // string "null"; Sec-Fetch-Site is immune to that.
  const r = run({ headers: { origin: 'null', 'sec-fetch-site': 'same-origin' } });
  assert.equal(r.allowed, true);
});

test('cross-site sec-fetch-site does not grant access on its own', () => {
  const r = run({ headers: { 'sec-fetch-site': 'cross-site' } });
  assert.equal(r.allowed, false);
});

test("self-host single-origin POST passes when Origin matches the request's own host", () => {
  const r = run({ headers: { origin: 'https://portal.example.com', host: 'portal.example.com' } });
  assert.equal(r.allowed, true);
});

test('Referer is accepted as an Origin fallback', () => {
  assert.equal(run({ headers: { referer: `${WEB_ORIGIN}/todos` } }).allowed, true);
  assert.equal(run({ headers: { referer: 'https://evil.example/attack' } }).allowed, false);
  assert.equal(run({ headers: { referer: 'not a url' } }).allowed, false);
});

test('session token echoed in x-csrf-token passes; mismatch does not', () => {
  const session = { csrfToken: 'tok-123' };
  assert.equal(run({ headers: { 'x-csrf-token': 'tok-123' }, session }).allowed, true);
  const bad = run({ headers: { 'x-csrf-token': 'wrong' }, session });
  assert.equal(bad.allowed, false);
  assert.equal(bad.status, 403);
  // No token stored in the session → header alone proves nothing.
  assert.equal(run({ headers: { 'x-csrf-token': 'tok-123' }, session: {} }).allowed, false);
});

test('cookieless public surfaces are exempt even from foreign origins', () => {
  const evil = { origin: 'https://any-site.example' };
  assert.equal(run({ path: '/api/f/submit/tok', headers: evil }).allowed, true);
  assert.equal(run({ path: '/api/provisioning/account', headers: {} }).allowed, true);
  assert.equal(run({ path: '/api/upload/qr/abc123/files', headers: {} }).allowed, true);
});

test('exemptions do not leak onto adjacent cookie-authed routes', () => {
  // /api/forms (builder CRUD) is NOT /api/f; upload-QR admin /sessions routes
  // stay guarded despite the public :token/files exemption.
  assert.equal(run({ path: '/api/forms', headers: {} }).allowed, false);
  assert.equal(run({ path: '/api/upload/qr/sessions', headers: {} }).allowed, false);
  assert.equal(run({ path: '/api/upload/qr/sessions/xyz/revoke', headers: {} }).allowed, false);
});

test('exemptWhen skips the check for token-authenticated requests only', () => {
  const tokenGuard = csrfProtection({
    allowedOrigins: [WEB_ORIGIN],
    exemptPrefixes: [],
    exemptWhen: (req) => (req as unknown as { authVia?: string }).authVia === 'token',
  });
  const mk = (authVia?: string) => {
    let nextCalled = false;
    let status = 200;
    const req = { method: 'POST', path: '/api/entries', protocol: 'https', authVia, get: () => undefined, session: {} };
    const res = { status(c: number) { status = c; return res; }, json() { return res; } };
    tokenGuard(req as unknown as Request, res as unknown as Response, () => { nextCalled = true; });
    return { nextCalled, status };
  };
  assert.equal(mk('token').nextCalled, true);
  const cookie = mk(undefined);
  assert.equal(cookie.nextCalled, false);
  assert.equal(cookie.status, 403);
});
