import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SLASH_COMMANDS, TURN_INTO_OPTIONS } from '../commands';
import { buildNotesHelp, gutterHelp, isHelpHotkey, MARKDOWN_HELP } from '../help';
import { EDITABLE_TYPES, fuzzyScore, matchMarkdownShortcut } from '../blocks';

test('every slash command appears in the reference exactly once', () => {
  const rows = buildNotesHelp()
    .filter((s) => s.id.startsWith('slash-') && s.id !== 'slash-keys')
    .flatMap((s) => s.rows);
  assert.equal(rows.length, SLASH_COMMANDS.length);
  for (const c of SLASH_COMMANDS) {
    const hits = rows.filter((r) => r.keys[0] === `/${c.id}` && r.label === c.label);
    assert.equal(hits.length, 1, `missing /${c.id}`);
  }
});

test('the typed /id shown in the reference actually finds the command', () => {
  for (const c of SLASH_COMMANDS) assert.ok(fuzzyScore(c.id, c.id) > 0, c.id);
});

test('slash command ids are unique', () => {
  assert.equal(new Set(SLASH_COMMANDS.map((c) => c.id)).size, SLASH_COMMANDS.length);
});

test('each documented markdown trigger really converts the block', () => {
  for (const m of MARKDOWN_HELP) {
    for (const t of [m.trigger, ...(m.alt ? [m.alt] : [])]) {
      const md = matchMarkdownShortcut(t, t.length);
      assert.ok(md, `"${t}" did not trigger`);
      if (m.result === 'divider') assert.equal(md.kind, 'divider');
      else assert.deepEqual(md, { kind: 'type', type: m.result, strip: t.length });
    }
  }
});

test('the markdown list covers every shortcut the editor supports', () => {
  // Probe the candidates the editor might accept and make sure every one
  // that fires is documented (catches a new shortcut added without help).
  const probes = ['# ', '## ', '### ', '- ', '* ', '+ ', '1. ', '1) ', '[] ', '[ ] ', '> ', '---', '``` ', '" '];
  const documented = new Set(MARKDOWN_HELP.map((m) => m.result));
  for (const p of probes) {
    const md = matchMarkdownShortcut(p, p.length);
    if (!md) continue;
    assert.ok(documented.has(md.kind === 'divider' ? 'divider' : md.type), `undocumented shortcut "${p}"`);
  }
});

test('markdown triggers render with a visible Space key', () => {
  const md = buildNotesHelp().find((s) => s.id === 'markdown')!;
  assert.deepEqual(md.rows[0]!.keys, ['#', 'Space']);
  assert.deepEqual(md.rows.find((r) => r.label === 'Bulleted list')!.keys, ['-', 'Space', 'or', '*', 'Space']);
  assert.deepEqual(md.rows.find((r) => r.label === 'Divider')!.keys, ['---']);
});

test('gutter help lists every Turn into target', () => {
  const row = gutterHelp().find((r) => r.keys[0] === 'Turn into')!;
  for (const o of TURN_INTO_OPTIONS) assert.ok(row.label.includes(o.label), o.label);
  for (const o of TURN_INTO_OPTIONS) assert.ok(EDITABLE_TYPES.has(o.type), o.type);
});

test('reference has the keyboard, menu and gutter sections', () => {
  const ids = buildNotesHelp().map((s) => s.id);
  for (const id of ['markdown', 'keyboard', 'slash-keys', 'gutter']) assert.ok(ids.includes(id), id);
});

test('help hotkey: ? and Cmd/Ctrl+/ only', () => {
  const k = (key: string, m: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean }> = {}) =>
    isHelpHotkey({ key, metaKey: false, ctrlKey: false, altKey: false, ...m });
  assert.equal(k('?'), true);
  assert.equal(k('/', { metaKey: true }), true);
  assert.equal(k('/', { ctrlKey: true }), true);
  assert.equal(k('/'), false);
  assert.equal(k('?', { metaKey: true }), false);
  assert.equal(k('/', { ctrlKey: true, altKey: true }), false);
  assert.equal(k('a'), false);
});
