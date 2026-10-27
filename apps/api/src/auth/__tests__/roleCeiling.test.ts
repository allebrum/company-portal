import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { requirePermission, userCan } from '../permissions.js';

/**
 * Role ceiling: token requests carry the owner's { userId, tenantId } on a
 * synthetic session and go through the SAME RBAC middleware as the browser.
 * Permissions are loaded per request (memoized only on that request), so a
 * token with `full` scope is still refused when the owner lacks the
 * permission — e.g. after being demoted.
 */
function tokenReq(perms: string[]): Request {
  return {
    authVia: 'token',
    apiToken: { id: 't1', name: 'bot', scopes: ['full'], expiresAt: null },
    session: { user: { userId: 'u1', tenantId: 't1' } },
    _perms: new Set(perms),
  } as unknown as Request;
}

function run(mw: ReturnType<typeof requirePermission>, req: Request) {
  return new Promise<{ status?: number; body?: unknown; next: boolean }>((resolve) => {
    const res = {
      status(code: number) {
        return { json: (body: unknown) => resolve({ status: code, body, next: false }) };
      },
    } as unknown as Response;
    void mw(req, res, () => resolve({ next: true }));
  });
}

test('a full-access token whose owner lacks the permission is refused', async () => {
  const out = await run(requirePermission('users.manage'), tokenReq(['time_entry.create']));
  assert.equal(out.next, false);
  assert.equal(out.status, 403);
  assert.deepEqual(out.body, { error: 'forbidden', missing: ['users.manage'] });
});

test('the same token passes once the owner holds the permission', async () => {
  const out = await run(requirePermission('users.manage'), tokenReq(['users.manage']));
  assert.equal(out.next, true);
});

test('userCan (inline route checks, e.g. project rename) follows the owner too', async () => {
  assert.equal(await userCan(tokenReq([]), 'projects.manage'), false);
  assert.equal(await userCan(tokenReq(['projects.manage']), 'projects.manage'), true);
});
