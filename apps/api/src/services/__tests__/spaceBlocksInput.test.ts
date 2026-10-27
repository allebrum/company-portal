import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppendSpaceBlocksSchema } from '@allebrum/shared';
import { isUuid, normalizeAppendBlocks, parseSpaceKind } from '../spaceBlocksInput.js';
import { readExpectedUpdatedAt } from '../../middleware/expectedUpdatedAt.js';

const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};

test('parseSpaceKind accepts singular and plural', () => {
  assert.equal(parseSpaceKind('client'), 'client');
  assert.equal(parseSpaceKind('clients'), 'client');
  assert.equal(parseSpaceKind('projects'), 'project');
  assert.equal(parseSpaceKind('users'), null);
  assert.equal(parseSpaceKind(undefined), null);
  assert.ok(isUuid('2b48b44a-1ffa-466b-8050-51d8c6ff8204'));
  assert.ok(!isUuid('nope'));
});

test('multi-line text becomes one block per line, ids are server-assigned', () => {
  const input = AppendSpaceBlocksSchema.parse({
    blocks: [{ content: 'one\r\ntwo\nthree' }, { type: 'checkbox', content: 'call back' }, { type: 'divider' }],
  }).blocks;
  assert.deepEqual(normalizeAppendBlocks(input, ids()), [
    { id: 'id1', type: 'text', content: 'one' },
    { id: 'id2', type: 'text', content: 'two' },
    { id: 'id3', type: 'text', content: 'three' },
    { id: 'id4', type: 'checkbox', content: 'call back', checked: false },
    { id: 'id5', type: 'divider' },
  ]);
});

test('schema strips client ids and rejects linked card types', () => {
  const parsed = AppendSpaceBlocksSchema.parse({ blocks: [{ id: 'evil', content: 'x' }] });
  assert.equal('id' in parsed.blocks[0]!, false);
  assert.equal(AppendSpaceBlocksSchema.safeParse({ blocks: [{ type: 'todo', content: 'x' }] }).success, false);
  assert.equal(AppendSpaceBlocksSchema.safeParse({ blocks: [] }).success, false);
});

test('embed requires an http(s) URL', () => {
  const ok = normalizeAppendBlocks([{ type: 'embed', embedUrl: 'https://www.wysa.com/ai-self-help' }], ids());
  assert.deepEqual(ok, [{ id: 'id1', type: 'embed', embedUrl: 'https://www.wysa.com/ai-self-help', embedKind: 'link', content: '' }]);
  assert.throws(() => normalizeAppendBlocks([{ type: 'embed', embedUrl: 'javascript:alert(1)' }], ids()), /invalid_embed_url/);
});

test('x-expected-updated-at accepts ISO and Postgres text timestamps', () => {
  assert.equal(readExpectedUpdatedAt(undefined), undefined);
  assert.equal(readExpectedUpdatedAt(''), undefined);
  assert.equal(readExpectedUpdatedAt('2026-10-23 23:39:49.853-07'), '2026-10-23 23:39:49.853-07');
  assert.equal(readExpectedUpdatedAt('2026-10-23T10:00:00.000Z'), '2026-10-23T10:00:00.000Z');
  assert.throws(() => readExpectedUpdatedAt('yesterday'), /invalid_expected_updated_at/);
  assert.throws(() => readExpectedUpdatedAt('2026-10-23'), /invalid_expected_updated_at/);
});

test('applyBlockPatch edits one block in place and keeps its id', async () => {
  const { applyBlockPatch } = await import('../spaceBlocksInput.js');
  const b = applyBlockPatch({ id: 'b1', type: 'text', content: 'old' }, { content: 'new' });
  assert.deepEqual(b, { id: 'b1', type: 'text', content: 'new' });
  const c = applyBlockPatch({ id: 'b2', type: 'text', content: 'task' }, { type: 'checkbox', checked: true });
  assert.deepEqual(c, { id: 'b2', type: 'checkbox', content: 'task', checked: true });
  assert.throws(() => applyBlockPatch({ id: 'b3', type: 'todo', todoId: null }, { content: 'x' }), /linked_block_not_editable/);
  assert.throws(() => applyBlockPatch({ id: 'b4', type: 'text', content: '' }, { content: 'a\nb' }), /single_line_content_required/);
  assert.throws(() => applyBlockPatch({ id: 'b5', type: 'text' }, { type: 'embed', embedUrl: 'javascript:alert(1)' }), /invalid_embed_url/);
});
