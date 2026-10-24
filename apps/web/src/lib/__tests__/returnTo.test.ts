import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginUrl, safeReturnTo } from '../returnTo';

test('accepts same-origin app paths with query and hash', () => {
  assert.equal(safeReturnTo('/clients/?space=client:abc&tab=notes'), '/clients/?space=client:abc&tab=notes');
  assert.equal(safeReturnTo('/dashboard#x'), '/dashboard#x');
});

test('rejects off-site and odd targets', () => {
  for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', 'javascript:alert(1)', 'clients', '', null, undefined, '/a\\b', '/x\u0000', '/' + 'a'.repeat(2001)]) {
    assert.equal(safeReturnTo(bad as string), null, String(bad));
  }
});

test('never returns to auth pages or the root (they would bounce)', () => {
  for (const p of ['/login', '/login/', '/login?next=/x', '/signup', '/forgot-password/', '/reset-password', '/accept-invite', '/']) {
    assert.equal(safeReturnTo(p), null, p);
  }
});

test('loginUrl carries next and the expired flag', () => {
  assert.equal(loginUrl('/clients/?space=client:1'), '/login?next=%2Fclients%2F%3Fspace%3Dclient%3A1');
  assert.equal(loginUrl('/clients/', { expired: true }), '/login?next=%2Fclients%2F&expired=1');
  assert.equal(loginUrl('/login/'), '/login');
  assert.equal(loginUrl(null, { expired: true }), '/login?expired=1');
});
