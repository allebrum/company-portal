import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SpaceBlock } from '@allebrum/shared';
import { applyDraft, DRAFT_TTL_MS, draftKey, saveDraft, takeDraft, type DraftStorage } from '../drafts';

const t = (id: string, content = id): SpaceBlock => ({ id, type: 'text', content });
const memStore = (): DraftStorage & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
};

test('draft keys are per user and per Space', () => {
  assert.notEqual(draftKey('u1', 'client', 'a'), draftKey('u2', 'client', 'a'));
  assert.notEqual(draftKey('u1', 'client', 'a'), draftKey('u1', 'project', 'a'));
});

test('save then take round-trips once', () => {
  const s = memStore();
  const k = draftKey('u1', 'client', 'a');
  assert.equal(saveDraft(k, { blocks: [t('a', 'typed')], base: [t('a')], baseUpdatedAt: 'v1' }, s, 1000), true);
  const d = takeDraft(k, s, 2000);
  assert.deepEqual(d?.blocks, [t('a', 'typed')]);
  assert.equal(d?.baseUpdatedAt, 'v1');
  assert.equal(takeDraft(k, s, 2000), null, 'taken drafts are removed');
});

test('expired and malformed drafts are discarded', () => {
  const s = memStore();
  const k = draftKey('u1', 'client', 'a');
  saveDraft(k, { blocks: [t('a', 'x')], base: [t('a')], baseUpdatedAt: null }, s, 0);
  assert.equal(takeDraft(k, s, DRAFT_TTL_MS + 1), null);
  assert.equal(s.map.size, 0);
  s.setItem(k, '{not json');
  assert.equal(takeDraft(k, s), null);
  s.setItem(k, JSON.stringify({ v: 2, blocks: [], base: [] }));
  assert.equal(takeDraft(k, s), null);
});

test('storage errors never throw', () => {
  const broken: DraftStorage = {
    getItem: () => { throw new Error('denied'); },
    setItem: () => { throw new Error('quota'); },
    removeItem: () => { throw new Error('denied'); },
  };
  assert.equal(saveDraft('k', { blocks: [], base: [], baseUpdatedAt: null }, broken), false);
  assert.equal(takeDraft('k', broken), null);
  assert.equal(saveDraft('k', { blocks: [], base: [], baseUpdatedAt: null }, null), false);
});

test('applyDraft merges stranded edits onto a server copy that moved on', () => {
  const draft = { v: 1 as const, blocks: [t('a', 'a typed'), t('mine')], base: [t('a')], baseUpdatedAt: 'v1', savedAt: 0 };
  // A bot appended while the user was signed out.
  const merged = applyDraft(draft, [t('a'), t('bot')]);
  assert.deepEqual(merged?.map((b) => `${b.id}:${b.content}`), ['a:a typed', 'bot:bot', 'mine:mine']); // server blocks sit after their server predecessor
});

test('applyDraft is a no-op when the draft adds nothing', () => {
  assert.equal(applyDraft({ v: 1, blocks: [t('a')], base: [t('a')], baseUpdatedAt: null, savedAt: 0 }, [t('a'), t('b')]), null);
  // Already saved (server has the same edits).
  assert.equal(applyDraft({ v: 1, blocks: [t('a', 'x')], base: [t('a')], baseUpdatedAt: null, savedAt: 0 }, [t('a', 'x')]), null);
});
