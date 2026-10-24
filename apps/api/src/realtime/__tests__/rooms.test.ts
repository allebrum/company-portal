import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSpaceRef, roomForSpace, roomForTenant } from '../rooms.js';

const ID = '2b48b44a-1ffa-466b-8050-51d8c6ff8204';

test('space rooms are namespaced under the tenant room', () => {
  assert.equal(roomForSpace('t1', 'client', ID), `tenant:t1:space:client:${ID}`);
  assert.ok(roomForSpace('t1', 'project', ID).startsWith(`${roomForTenant('t1')}:`));
  assert.notEqual(roomForSpace('t1', 'client', ID), roomForSpace('t2', 'client', ID));
});

test('parseSpaceRef accepts only {kind: client|project, id: uuid}', () => {
  assert.deepEqual(parseSpaceRef({ kind: 'client', id: ID }), { kind: 'client', id: ID });
  assert.deepEqual(parseSpaceRef({ kind: 'project', id: ID, extra: 1 }), { kind: 'project', id: ID });
  for (const bad of [null, 'x', 42, {}, { kind: 'clients', id: ID }, { kind: 'client', id: 'nope' },
    { kind: 'client', id: `${ID}:x` }, { kind: 'client' }, { id: ID }]) {
    assert.equal(parseSpaceRef(bad), null, JSON.stringify(bad));
  }
});
