import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SpaceBlock } from '@allebrum/shared';
import {
  reducer, migrateBlocks, matchMarkdownShortcut, findSlashToken, removeSlashToken, pastedLines, fuzzyScore,
} from '../blocks';

const t = (id: string, content = ''): SpaceBlock => ({ id, type: 'text', content });
const ids = (bs: SpaceBlock[]) => bs.map((b) => b.id).join(',');

test('reducer insert: after anchor, null prepends, unknown anchor appends', () => {
  const s = [t('a'), t('b')];
  assert.equal(ids(reducer(s, { type: 'insert', after: 'a', block: t('x') })), 'a,x,b');
  assert.equal(ids(reducer(s, { type: 'insert', after: null, block: t('x') })), 'x,a,b');
  assert.equal(ids(reducer(s, { type: 'insert', after: 'gone', block: t('x') })), 'a,b,x');
  assert.equal(ids(reducer(s, { type: 'insertMany', after: 'a', blocks: [t('x'), t('y')] })), 'a,x,y,b');
  assert.equal(ids(reducer(s, { type: 'insertBefore', before: 'b', block: t('x') })), 'a,x,b');
});

test('reducer move before/after and no-ops', () => {
  const s = [t('a'), t('b'), t('c')];
  assert.equal(ids(reducer(s, { type: 'move', id: 'a', target: 'c', position: 'after' })), 'b,c,a');
  assert.equal(ids(reducer(s, { type: 'move', id: 'c', target: 'a', position: 'before' })), 'c,a,b');
  assert.equal(reducer(s, { type: 'move', id: 'a', target: 'a', position: 'after' }), s);
  assert.equal(reducer(s, { type: 'move', id: 'a', target: 'nope', position: 'after' }), s);
});

test('migrateBlocks splits multi-line text into one block per line', () => {
  let n = 0;
  const out = migrateBlocks(
    [t('a', 'one\ntwo\r\nthree\n\n'), { id: 'q', type: 'quote', content: 'x\ny' }, t('b', 'solo')],
    () => `n${++n}`,
  );
  assert.deepEqual(out.map((b) => [b.id, b.type, b.content]), [
    ['a', 'text', 'one'],
    ['n1', 'text', 'two'],
    ['n2', 'text', 'three'],
    ['q', 'quote', 'x\ny'],
    ['b', 'text', 'solo'],
  ]);
});

test('migrateBlocks always returns a new array (so init never counts as an edit)', () => {
  const input = [t('a', 'x')];
  const out = migrateBlocks(input);
  assert.notEqual(out, input);
  assert.equal(out[0], input[0]);
});

test('markdown shortcuts', () => {
  assert.deepEqual(matchMarkdownShortcut('# ', 2), { kind: 'type', type: 'h1', strip: 2 });
  assert.deepEqual(matchMarkdownShortcut('## hello', 3), { kind: 'type', type: 'h2', strip: 3 });
  assert.deepEqual(matchMarkdownShortcut('### ', 4), { kind: 'type', type: 'h3', strip: 4 });
  assert.equal((matchMarkdownShortcut('- ', 2) as { type: string }).type, 'bullet');
  assert.equal((matchMarkdownShortcut('* ', 2) as { type: string }).type, 'bullet');
  assert.equal((matchMarkdownShortcut('1. ', 3) as { type: string }).type, 'numbered');
  assert.equal((matchMarkdownShortcut('[] ', 3) as { type: string }).type, 'checkbox');
  assert.equal((matchMarkdownShortcut('> ', 2) as { type: string }).type, 'quote');
  assert.deepEqual(matchMarkdownShortcut('---', 3), { kind: 'divider' });
  assert.equal(matchMarkdownShortcut('a # ', 4), null);
  assert.equal(matchMarkdownShortcut('#', 1), null);
});

test('findSlashToken uses the text before the caret', () => {
  assert.deepEqual(findSlashToken('/', 1), { query: '', tokenStart: 0 });
  assert.deepEqual(findSlashToken('hello /he', 9), { query: 'he', tokenStart: 6 });
  // caret in the middle of a line, text after the caret is ignored
  assert.deepEqual(findSlashToken('ab /to cd', 6), { query: 'to', tokenStart: 3 });
  assert.equal(findSlashToken('06/05', 5), null);
  assert.equal(findSlashToken('https://x', 9), null);
  assert.equal(findSlashToken('/to do', 6), null);
});

test('removeSlashToken removes exactly the token at tokenStart', () => {
  assert.deepEqual(removeSlashToken('ab /to cd', 3, 'to'), { content: 'ab  cd', caret: 3 });
  assert.deepEqual(removeSlashToken('/h1', 0, 'h1'), { content: '', caret: 0 });
  // stale tokenStart → trailing-token fallback
  assert.deepEqual(removeSlashToken('xx /h1', 0, 'h1'), { content: 'xx ', caret: 3 });
});

test('pastedLines normalises line endings', () => {
  assert.deepEqual(pastedLines('a\r\nb\rc\nd'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(pastedLines('a\u00A0b'), ['a b']);
});

test('fuzzyScore ranks prefix > word-prefix > substring > subsequence', () => {
  const p = fuzzyScore('he', 'Heading 1');
  const w = fuzzyScore('li', 'Bulleted list');
  const sub = fuzzyScore('ead', 'Heading 1');
  const seq = fuzzyScore('hd1', 'Heading 1');
  assert.ok(p > w && w > sub && sub > seq && seq > 0);
  assert.equal(fuzzyScore('zzz', 'Heading 1'), 0);
  assert.equal(fuzzyScore('', 'anything'), 1);
});
