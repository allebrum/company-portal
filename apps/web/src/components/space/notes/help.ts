/**
 * Content for the Notes shortcuts reference (the "?" panel). Commands come
 * straight from SLASH_COMMANDS / TURN_INTO_OPTIONS; the markdown triggers
 * are checked against matchMarkdownShortcut in the unit tests so a change
 * to the editor that isn't reflected here fails CI.
 */
import { SLASH_COMMANDS, SLASH_GROUP_LABELS, TURN_INTO_OPTIONS, type SlashGroup } from './commands';
import type { BlockType } from './blocks';

export type HelpRow = { keys: string[]; label: string; hint?: string };
export type HelpSection = { id: string; title: string; note?: string; rows: HelpRow[] };

/** Markdown shortcuts, typed at the start of an empty text line. */
export const MARKDOWN_HELP: readonly { trigger: string; alt?: string; result: BlockType | 'divider'; label: string }[] = [
  { trigger: '# ',   result: 'h1',       label: 'Heading 1' },
  { trigger: '## ',  result: 'h2',       label: 'Heading 2' },
  { trigger: '### ', result: 'h3',       label: 'Heading 3' },
  { trigger: '- ',   alt: '* ', result: 'bullet', label: 'Bulleted list' },
  { trigger: '1. ',  result: 'numbered', label: 'Numbered list' },
  { trigger: '[] ',  result: 'checkbox', label: 'Checkbox' },
  { trigger: '> ',   result: 'quote',    label: 'Quote' },
  { trigger: '---',  result: 'divider',  label: 'Divider' },
];

/** Shown as "Space" so a trailing space in a trigger is visible. */
function showTrigger(t: string): string[] {
  return t.endsWith(' ') ? [t.trimEnd(), 'Space'] : [t];
}

export const KEYBOARD_HELP: readonly HelpRow[] = [
  { keys: ['Enter'], label: 'New line (splits the block at the caret)', hint: 'On an empty list item, ends the list' },
  { keys: ['Shift', 'Enter'], label: 'Line break inside the same block' },
  { keys: ['Backspace'], label: 'At the start of a heading, list or quote: turn it back into text' },
  { keys: ['Backspace'], label: 'At the start of a text line: join it to the line above', hint: 'On an empty line, removes it' },
  { keys: ['Delete'], label: 'At the end of a line: pull the next line up' },
  { keys: ['↑', '↓'], label: 'From the first/last line, move to the block above/below' },
  { keys: ['←', '→'], label: 'From the start/end, move to the previous/next block' },
  { keys: ['Esc'], label: 'Close the slash menu, a block menu or this panel' },
  { keys: ['?'], label: 'Open this reference (when not typing in a block)', hint: 'Cmd/Ctrl + / works even while typing' },
];

export const SLASH_MENU_KEYS: readonly HelpRow[] = [
  { keys: ['/'], label: 'Open the command menu (start of line or after a space)' },
  { keys: ['↑', '↓'], label: 'Move through commands', hint: 'Tab / Shift+Tab work too' },
  { keys: ['Enter'], label: 'Insert the highlighted command' },
  { keys: ['Esc'], label: 'Close the menu and keep what you typed', hint: 'Typing a space closes it too' },
];

export function gutterHelp(): HelpRow[] {
  return [
    { keys: ['Hover'], label: 'Hover a line to show its handles on the left' },
    { keys: ['Trash'], label: 'Delete the block (with Undo)' },
    { keys: ['Drag ⋮⋮'], label: 'Drag the handle to reorder blocks' },
    { keys: ['Click ⋮⋮'], label: 'Open block options: Delete, Duplicate, Turn into…', hint: 'Enter or Space when the handle is focused' },
    {
      keys: ['Turn into'],
      label: TURN_INTO_OPTIONS.map((o) => o.label).join(', '),
    },
    { keys: ['Cards'], label: 'To-do, goal, link and embed cards: Backspace/Delete removes (with Undo), Enter adds a line below' },
  ];
}

export function slashCommandSections(): HelpSection[] {
  const order: SlashGroup[] = [];
  for (const c of SLASH_COMMANDS) if (!order.includes(c.group)) order.push(c.group);
  return order.map((g) => ({
    id: `slash-${g}`,
    title: `/ ${SLASH_GROUP_LABELS[g]}`,
    rows: SLASH_COMMANDS.filter((c) => c.group === g).map((c) => ({ keys: [`/${c.id}`], label: c.label, hint: c.hint })),
  }));
}

export function buildNotesHelp(): HelpSection[] {
  return [
    ...slashCommandSections(),
    {
      id: 'markdown',
      title: 'Markdown shortcuts',
      note: 'Type at the start of an empty line.',
      rows: MARKDOWN_HELP.map((m) => ({
        keys: m.alt ? [...showTrigger(m.trigger), 'or', ...showTrigger(m.alt)] : showTrigger(m.trigger),
        label: m.label,
      })),
    },
    { id: 'keyboard', title: 'Keyboard', rows: [...KEYBOARD_HELP] },
    { id: 'slash-keys', title: 'In the / menu', rows: [...SLASH_MENU_KEYS] },
    { id: 'gutter', title: 'Block handles (gutter)', rows: gutterHelp() },
  ];
}

/** True when a keydown should open the reference (and not type a character). */
export function isHelpHotkey(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  if (e.altKey) return false;
  if (e.key === '/' && (e.metaKey || e.ctrlKey)) return true;
  return e.key === '?' && !e.metaKey && !e.ctrlKey;
}
