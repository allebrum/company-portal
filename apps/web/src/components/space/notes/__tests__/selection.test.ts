import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SpaceBlock } from '@allebrum/shared';
import {
  selectedIds, pruneSelection, extendSelection, selectAll, selectAllEscalates, shiftArrowLeavesBlock,
  selectionFromEdge, replaceSelection, listNumbers, blocksToPlainText, blocksToHtml, escapeHtml,
} from '../selection';
import { reducer } from '../blocks';

const b = (id: string, type: SpaceBlock['type'] = 'text', content = id, extra: Partial<SpaceBlock> = {}): SpaceBlock => ({ id, type, content, ...extra });
const doc = [b('a'), b('b'), b('c'), b('d'), b('e')];
const ids = (bs: Pick<SpaceBlock, 'id'>[]) => bs.map((x) => x.id).join(',');

test('selectedIds: inclusive range in document order, either direction', () => {
  assert.deepEqual(selectedIds(doc, { anchor: 'b', focus: 'd' }), ['b', 'c', 'd']);
  assert.deepEqual(selectedIds(doc, { anchor: 'd', focus: 'b' }), ['b', 'c', 'd']);
  assert.deepEqual(selectedIds(doc, { anchor: 'c', focus: 'c' }), ['c']);
  assert.deepEqual(selectedIds(doc, null), []);
  assert.deepEqual(selectedIds(doc, { anchor: 'zz', focus: 'b' }), []);
});

test('selectedIds follows the live order after a reorder/merge', () => {
  const moved = reducer(doc, { type: 'move', id: 'e', target: 'b', position: 'after' });
  assert.deepEqual(selectedIds(moved, { anchor: 'b', focus: 'c' }), ['b', 'e', 'c']);
});

test('pruneSelection: keeps valid, collapses onto the surviving end, else null', () => {
  const sel = { anchor: 'b', focus: 'd' };
  assert.equal(pruneSelection(doc, sel), sel);
  assert.deepEqual(pruneSelection(doc.filter((x) => x.id !== 'd'), sel), { anchor: 'b', focus: 'b' });
  assert.deepEqual(pruneSelection(doc.filter((x) => x.id !== 'b'), sel), { anchor: 'd', focus: 'd' });
  assert.equal(pruneSelection(doc.filter((x) => x.id !== 'b' && x.id !== 'd'), sel), null);
  assert.equal(pruneSelection(doc, null), null);
});

test('extendSelection moves only the focus end and clamps', () => {
  assert.deepEqual(extendSelection(doc, { anchor: 'c', focus: 'c' }, 'down'), { anchor: 'c', focus: 'd' });
  assert.deepEqual(extendSelection(doc, { anchor: 'c', focus: 'd' }, 'up'), { anchor: 'c', focus: 'c' });
  assert.deepEqual(extendSelection(doc, { anchor: 'c', focus: 'c' }, 'up'), { anchor: 'c', focus: 'b' });
  assert.deepEqual(extendSelection(doc, { anchor: 'c', focus: 'e' }, 'down'), { anchor: 'c', focus: 'e' });
  assert.deepEqual(extendSelection(doc, { anchor: 'c', focus: 'a' }, 'up'), { anchor: 'c', focus: 'a' });
});

test('selectAll / Cmd+A two-step', () => {
  assert.deepEqual(selectAll(doc), { anchor: 'a', focus: 'e' });
  assert.equal(selectAll([]), null);
  assert.equal(selectAllEscalates(5, 2, 2), false, 'caret only → native select block text');
  assert.equal(selectAllEscalates(5, 0, 3), false, 'partial → native');
  assert.equal(selectAllEscalates(5, 0, 5), true, 'whole text already selected → all blocks');
  assert.equal(selectAllEscalates(5, 5, 0), true, 'backwards selection counts');
  assert.equal(selectAllEscalates(0, 0, 0), true, 'empty block → all blocks');
});

test('Shift+Arrow leaves the block only at its edge', () => {
  assert.equal(shiftArrowLeavesBlock('up', 10, 0, 4), true);
  assert.equal(shiftArrowLeavesBlock('up', 10, 3, 4), false);
  assert.equal(shiftArrowLeavesBlock('down', 10, 3, 10), true);
  assert.equal(shiftArrowLeavesBlock('down', 10, 3, 9), false);
  assert.equal(shiftArrowLeavesBlock('down', 0, 0, 0), true);
  assert.deepEqual(selectionFromEdge(doc, 'c', 'up'), { anchor: 'c', focus: 'b' });
  assert.deepEqual(selectionFromEdge(doc, 'c', 'down'), { anchor: 'c', focus: 'd' });
  assert.deepEqual(selectionFromEdge(doc, 'a', 'up'), { anchor: 'a', focus: 'a' });
  assert.equal(selectionFromEdge(doc, 'zz', 'up'), null);
});

test('replaceSelection: delete, type-over, everything, unknown ids', () => {
  const empty = () => b('fresh', 'text', '');
  const del = replaceSelection(doc, ['b', 'c'], [], empty);
  assert.equal(ids(del.blocks), 'a,d,e');
  assert.equal(ids(del.removed), 'b,c');
  assert.equal(del.prevId, 'a');

  const typed = replaceSelection(doc, ['c', 'b'], [b('n', 'text', 'x')], empty);
  assert.equal(ids(typed.blocks), 'a,n,d,e');

  const top = replaceSelection(doc, ['a', 'b'], [], empty);
  assert.equal(top.prevId, null);
  assert.equal(ids(top.blocks), 'c,d,e');

  const all = replaceSelection(doc, doc.map((x) => x.id), [], empty);
  assert.equal(ids(all.blocks), 'fresh', 'never leaves the canvas empty');

  const none = replaceSelection(doc, ['zz'], [b('n')], empty);
  assert.equal(ids(none.blocks), 'a,b,c,d,e');
});

test('reducer replaceRange/removeMany go through the normal state path', () => {
  const next = reducer(doc, { type: 'replaceRange', ids: ['b', 'c', 'd'], insert: [b('p1'), b('p2')], fallback: b('f') });
  assert.equal(ids(next), 'a,p1,p2,e');
  assert.equal(ids(reducer(doc, { type: 'removeMany', ids: ['a', 'e'] })), 'b,c,d');
  // Undo = insertMany after the block the run followed.
  const undone = reducer(reducer(doc, { type: 'removeMany', ids: ['b', 'c'] }), { type: 'insertMany', after: 'a', blocks: [doc[1]!, doc[2]!] });
  assert.equal(ids(undone), 'a,b,c,d,e');
});

const rich: SpaceBlock[] = [
  b('h1', 'h1', 'Title'),
  b('h2', 'h2', 'Section'),
  b('h3', 'h3', 'Sub'),
  b('p', 'text', 'Plain <b>&</b>'),
  b('u1', 'bullet', 'one'),
  b('u2', 'bullet', 'two'),
  b('n1', 'numbered', 'first'),
  b('n2', 'numbered', 'second'),
  b('c1', 'checkbox', 'todo', { checked: false }),
  b('c2', 'checkbox', 'done', { checked: true }),
  b('q', 'quote', 'line 1\nline 2'),
  b('hr', 'divider', ''),
  b('t', 'todo', 'Call Ana'),
  b('em', 'embed', '', { embedUrl: 'https://figma.com/x' }),
];

test('plain text: one line per block with markdown prefixes', () => {
  assert.equal(
    blocksToPlainText(rich),
    [
      '# Title', '## Section', '### Sub', 'Plain <b>&</b>',
      '- one', '- two', '1. first', '2. second',
      '- [ ] todo', '- [x] done',
      '> line 1', '> line 2', '---', '- [ ] Call Ana', 'https://figma.com/x',
    ].join('\n'),
  );
});

test('plain text keeps document numbering for a partial numbered run', () => {
  const list = [b('x', 'text'), b('n1', 'numbered', 'a'), b('n2', 'numbered', 'b'), b('n3', 'numbered', 'c'), b('y'), b('m1', 'numbered', 'z')];
  const nums = listNumbers(list);
  assert.deepEqual([...nums.entries()], [['n1', 1], ['n2', 2], ['n3', 3], ['m1', 1]]);
  assert.equal(blocksToPlainText(list.slice(2, 4), nums), '2. b\n3. c');
});

test('plain text strips the zero-width caret sentinel', () => {
  assert.equal(blocksToPlainText([b('z', 'text', 'hi\u200B')]), 'hi');
});

test('html: semantic tags, grouped lists, escaped text', () => {
  const html = blocksToHtml(rich);
  assert.ok(html.startsWith('<h1>Title</h1><h2>Section</h2><h3>Sub</h3><p>Plain &lt;b&gt;&amp;&lt;/b&gt;</p>'));
  assert.ok(html.includes('<ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>'));
  assert.ok(html.includes('<ul><li><input type="checkbox" disabled> todo</li><li><input type="checkbox" disabled checked> done</li></ul>'));
  assert.ok(html.includes('<blockquote>line 1<br>line 2</blockquote><hr>'));
  assert.ok(html.includes('<ul><li><input type="checkbox" disabled> Call Ana</li></ul>'));
  assert.ok(html.endsWith('<p><a href="https://figma.com/x">https://figma.com/x</a></p>'));
});

test('html: a partial numbered run keeps its start number', () => {
  const list = [b('n1', 'numbered', 'a'), b('n2', 'numbered', 'b'), b('n3', 'numbered', 'c')];
  assert.equal(blocksToHtml(list.slice(1), listNumbers(list)), '<ol start="2"><li>b</li><li>c</li></ol>');
});

test('html never emits a javascript: link', () => {
  const html = blocksToHtml([b('e', 'embed', '', { embedUrl: 'javascript:alert(1)' })]);
  assert.ok(!html.includes('<a '));
  assert.equal(escapeHtml('"<>&'), '&quot;&lt;&gt;&amp;');
});
