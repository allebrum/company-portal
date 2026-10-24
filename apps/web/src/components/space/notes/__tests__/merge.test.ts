import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SpaceBlock } from '@allebrum/shared';
import { isNewerVersion, mergeBlocks, sameBlock, sameBlocks, versionMs } from '../merge';
import { reducer } from '../blocks';

const t = (id: string, content = id): SpaceBlock => ({ id, type: 'text', content });
const ids = (bs: SpaceBlock[]) => bs.map((b) => b.id).join(',');
const text = (bs: SpaceBlock[]) => bs.map((b) => `${b.id}:${b.content ?? ''}`).join(',');

test('no changes anywhere returns local by reference', () => {
  const base = [t('a'), t('b')];
  const local = [...base];
  assert.equal(mergeBlocks(base, local, [t('a'), t('b')]), local);
});

test('bot append: server-only blocks land at the end, local edits kept', () => {
  const base = [t('a'), t('b')];
  const local = [t('a', 'a edited'), t('b'), t('mine')];
  const server = [t('a'), t('b'), t('bot1'), t('bot2')];
  const out = mergeBlocks(base, local, server);
  // Bot blocks go right after their server predecessor "b"; the unsaved
  // local block "mine" keeps its place after b, so it ends up below them.
  assert.equal(ids(out), 'a,b,bot1,bot2,mine');
  assert.equal(out[0]!.content, 'a edited');
});

test('server-only block goes after its nearest surviving server predecessor', () => {
  const base = [t('a'), t('b'), t('c')];
  const local = [t('a'), t('c')]; // user deleted b
  const server = [t('a'), t('b'), t('x'), t('c')];
  assert.equal(ids(mergeBlocks(base, local, server)), 'a,x,c');
});

test('server-only block at the very top goes before its successor', () => {
  const base = [t('a')];
  const out = mergeBlocks(base, [t('a')], [t('top'), t('a')]);
  assert.equal(ids(out), 'top,a');
});

test('no anchor at all → appended at the end', () => {
  const base = [t('a')];
  const local = [t('mine')]; // user deleted a and wrote something new
  const out = mergeBlocks(base, local, [t('a'), t('bot')]);
  assert.equal(ids(out), 'mine,bot');
});

test('local delete of a base block is respected even if the server edited it', () => {
  const base = [t('a'), t('b')];
  const out = mergeBlocks(base, [t('a')], [t('a'), t('b', 'server edit')]);
  assert.equal(ids(out), 'a');
});

test('both edited the same block → local wins', () => {
  const base = [t('a')];
  const out = mergeBlocks(base, [t('a', 'local')], [t('a', 'server')]);
  assert.equal(text(out), 'a:local');
});

test('only the server edited a block → server version adopted', () => {
  const base = [t('a'), t('b')];
  const out = mergeBlocks(base, [t('a'), t('b', 'mine')], [t('a', 'theirs'), t('b')]);
  assert.equal(text(out), 'a:theirs,b:mine');
});

test('server delete: dropped if untouched locally, kept if edited locally', () => {
  const base = [t('a'), t('b'), t('c')];
  const out = mergeBlocks(base, [t('a'), t('b', 'edited'), t('c')], [t('a')]);
  assert.equal(text(out), 'a:a,b:edited');
});

test('local order wins over a server reorder', () => {
  const base = [t('a'), t('b')];
  const local = [t('b'), t('a')];
  assert.equal(ids(mergeBlocks(base, local, [t('a'), t('b')])), 'b,a');
});

test('id clash between a new local and a new server block keeps the local one once', () => {
  const out = mergeBlocks([], [t('x', 'local')], [t('x', 'server')]);
  assert.equal(text(out), 'x:local');
});

test('merging the same server state twice is idempotent', () => {
  const base = [t('a')];
  const server = [t('a'), t('bot')];
  const once = mergeBlocks(base, [t('a', 'typed')], server);
  const twice = mergeBlocks(base, once, server);
  assert.equal(text(twice), text(once));
  assert.equal(twice, once);
});

test('empty base (first open of an empty space) keeps seed + server blocks', () => {
  const out = mergeBlocks([], [t('seed1'), t('seed2')], [t('bot')]);
  assert.equal(ids(out), 'seed1,seed2,bot');
});

test('sameBlock treats null/undefined as absent and compares every field', () => {
  assert.ok(sameBlock({ id: 'a', type: 'todo', todoId: null }, { id: 'a', type: 'todo' }));
  assert.ok(!sameBlock({ id: 'a', type: 'checkbox', checked: true }, { id: 'a', type: 'checkbox' }));
  assert.ok(!sameBlock(t('a'), { id: 'a', type: 'h1', content: 'a' }));
  assert.ok(sameBlocks([t('a')], [t('a')]));
  assert.ok(!sameBlocks([t('a'), t('b')], [t('b'), t('a')]));
});

test('reducer merge action merges into the live state (keeps keystrokes)', () => {
  const base = [t('a')];
  const live = [t('a', 'typed while saving')];
  const next = reducer(live, { type: 'merge', base, server: [t('a'), t('bot')] });
  assert.equal(text(next), 'a:typed while saving,bot:bot');
  // nothing new → same state reference (no re-render)
  assert.equal(reducer(next, { type: 'merge', base, server: [t('a'), t('bot')] }), next);
});

test('versionMs / isNewerVersion compare Postgres text and ISO versions as instants', () => {
  const iso = Date.parse('2026-10-24T16:05:22.936Z');
  assert.equal(versionMs('2026-10-24 09:05:22.936-07'), iso);
  assert.equal(versionMs('2026-10-24 09:05:22.936123-07'), iso);
  assert.equal(versionMs('2026-10-24T16:05:22.936Z'), iso);
  assert.equal(versionMs('2026-10-24 09:05:22+05:30'), Date.parse('2026-10-24T03:35:22Z'));
  assert.ok(isNewerVersion('2026-10-24 09:05:23-07', '2026-10-24 09:05:22.936-07'));
  assert.ok(!isNewerVersion('2026-10-24 09:05:22.936-07', '2026-10-24T16:05:22.936Z'));
  assert.ok(isNewerVersion('2026-10-24 09:05:22-07', null));
  assert.ok(!isNewerVersion(null, '2026-10-24 09:05:22-07'));
});
