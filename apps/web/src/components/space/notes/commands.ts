/**
 * Single source of truth for the Notes editor's command metadata. The slash
 * menu, the gutter "Turn into" menu and the shortcuts reference all read
 * from here, so the help can't drift from what the editor actually offers.
 * Kept free of React/icons so it can be unit-tested in plain node.
 */
import type { BlockType } from './blocks';

export type SlashCommandId =
  | 'text' | 'h1' | 'h2' | 'h3'
  | 'bullet' | 'numbered' | 'checkbox'
  | 'quote' | 'callout' | 'divider'
  | 'todo' | 'goal' | 'timer' | 'link' | 'embed' | 'mention' | 'upload';

export type SlashGroup = 'create' | 'heading' | 'block';

export type SlashCommand = {
  id: SlashCommandId;
  label: string;
  hint: string;
  group: SlashGroup;
  keywords: string[];
};

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { id: 'todo',     label: 'To-do',          hint: 'Create a real to-do, auto-linked',  group: 'create',  keywords: ['todo','task','do'] },
  { id: 'goal',     label: 'Goal',           hint: 'Create a roadmap goal, auto-linked', group: 'create', keywords: ['goal','milestone'] },
  { id: 'timer',    label: 'Timer',          hint: 'Start a timer for this scope',       group: 'create', keywords: ['timer','track','time'] },
  { id: 'link',     label: 'Link to item',   hint: 'Reference an existing goal/todo/file',group: 'create',keywords: ['link','ref','to'] },
  { id: 'embed',    label: 'Embed',          hint: 'Embed a URL (Figma, Drive, GitHub…)',group: 'create', keywords: ['embed','url','iframe'] },
  { id: 'mention',  label: 'Mention a teammate', hint: 'Insert @FirstName',              group: 'create', keywords: ['mention','at','user'] },
  { id: 'upload',   label: 'Image/file', hint: 'Insert via modal: computer, QR, or space files', group: 'create', keywords: ['upload','file','image','photo'] },

  { id: 'h1',       label: 'Heading 1',      hint: 'Big section title',                  group: 'heading', keywords: ['h1','heading','title'] },
  { id: 'h2',       label: 'Heading 2',      hint: 'Subsection title',                   group: 'heading', keywords: ['h2','heading'] },
  { id: 'h3',       label: 'Heading 3',      hint: 'Sub-subsection',                     group: 'heading', keywords: ['h3','heading'] },

  { id: 'text',     label: 'Text',           hint: 'Plain paragraph',                    group: 'block', keywords: ['text','paragraph','p'] },
  { id: 'bullet',   label: 'Bulleted list',  hint: '• item',                             group: 'block', keywords: ['bullet','list','ul'] },
  { id: 'numbered', label: 'Numbered list',  hint: '1. item',                            group: 'block', keywords: ['numbered','list','ol'] },
  { id: 'checkbox', label: 'Checkbox',       hint: 'Visual checkbox row',                group: 'block', keywords: ['check','box','task'] },
  { id: 'quote',    label: 'Quote',          hint: 'Italic, left-bordered block',        group: 'block', keywords: ['quote','blockquote'] },
  { id: 'callout',  label: 'Callout',        hint: 'Purple-tinted note',                 group: 'block', keywords: ['callout','note','tip'] },
  { id: 'divider',  label: 'Divider',        hint: 'Horizontal rule',                    group: 'block', keywords: ['divider','hr','line'] },
];

export const SLASH_GROUP_LABELS: Record<SlashGroup, string> = {
  create: 'Create & link',
  heading: 'Headings',
  block: 'Blocks',
};

/** Targets offered by the gutter menu's "Turn into" section. */
export const TURN_INTO_OPTIONS: readonly { type: BlockType; label: string }[] = [
  { type: 'text',     label: 'Text' },
  { type: 'h1',       label: 'Heading 1' },
  { type: 'h2',       label: 'Heading 2' },
  { type: 'h3',       label: 'Heading 3' },
  { type: 'bullet',   label: 'Bulleted list' },
  { type: 'numbered', label: 'Numbered list' },
  { type: 'checkbox', label: 'Checkbox' },
  { type: 'quote',    label: 'Quote' },
  { type: 'callout',  label: 'Callout' },
];
