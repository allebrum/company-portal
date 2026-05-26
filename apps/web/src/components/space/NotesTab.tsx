'use client';

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Trash2, GripVertical, Sparkles, Minus, Play, Square, Target, CheckCircle, Link as LinkIcon, ExternalLink, AtSign, Image as EmbedIcon } from 'lucide-react';
import { SlashMenu, type SlashCommandId } from './SlashMenu';
import { EmbedDialog, type EmbedDialogValue } from './pickers/EmbedDialog';
import { LinkPicker } from './pickers/LinkPicker';
import { MentionPicker } from './pickers/MentionPicker';
import {
  useGoals, useTodos, useUsers, useProjects, useCreateGoal, useCreateTodo,
  useStartTimer, useStopTimer,
  type GoalRow, type TodoRow,
} from '@/hooks/useResources';
import { useMyTimer } from '@/hooks/useTimer';
import { useAuth } from '@/hooks/useAuth';
import { useSpaceData, useUpdateSpaceBlocks, useUpdateSpaceFiles } from '@/hooks/useSpace';
import { useToast } from '@/components/ui/Toast';
import { fmtTimer, PRIORITY_DOT } from '@/lib/formatters';
import { rollupProgress } from '@/lib/roadmap';
import type { SpaceBlock, SpaceFile } from '@allebrum/shared';
import type { Scope } from '@/lib/roadmap';

// ============================================================================
// Reducer
// ============================================================================

type Action =
  | { type: 'init'; blocks: SpaceBlock[] }
  | { type: 'replace'; blocks: SpaceBlock[] }
  | { type: 'insert'; after: string | null; block: SpaceBlock }
  | { type: 'remove'; id: string }
  | { type: 'patch'; id: string; patch: Partial<SpaceBlock> };

function reducer(state: SpaceBlock[], action: Action): SpaceBlock[] {
  switch (action.type) {
    case 'init':
    case 'replace':
      return action.blocks;
    case 'insert': {
      const next = [...state];
      const i = action.after == null ? -1 : next.findIndex((b) => b.id === action.after);
      next.splice(i + 1, 0, action.block);
      return next;
    }
    case 'remove':
      return state.filter((b) => b.id !== action.id);
    case 'patch':
      return state.map((b) => (b.id === action.id ? { ...b, ...action.patch } : b));
    default:
      return state;
  }
}

const blockId = () => Math.random().toString(36).slice(2, 11);
const emptyText = (): SpaceBlock => ({ id: blockId(), type: 'text', content: '' });

// ============================================================================
// NotesTab — the canvas
// ============================================================================

export function NotesTab({ scope }: { scope: Scope }) {
  const data = useSpaceData(scope);
  const save = useUpdateSpaceBlocks(scope);
  const saveFiles = useUpdateSpaceFiles(scope);
  const { me } = useAuth();
  const toast = useToast();
  const [blocks, dispatch] = useReducer(reducer, [] as SpaceBlock[]);
  const initialized = useRef(false);

  // Sync from server on first load + scope change. After that, the local
  // reducer is the source of truth and we push out via debounced save.
  useEffect(() => {
    const scopeKey = scope.kind === 'all' ? null : scope.id;
    initialized.current = false;
    if (scope.kind === 'all') return;
    if (data.loading) return;
    if (data.spaceBlocks.length === 0) {
      // First open — seed welcome blocks.
      const scopeName = data.project?.name ?? data.client?.name ?? 'this space';
      const seed: SpaceBlock[] = [
        { id: blockId(), type: 'h1', content: scopeName },
        { id: blockId(), type: 'callout', content: `Type "/" anywhere to insert a to-do, goal, heading, list, link, embed, or @mention. Anything you create here is auto-linked to ${data.client?.name ?? scopeName}.` },
        emptyText(),
      ];
      dispatch({ type: 'init', blocks: seed });
      save(seed);
    } else {
      dispatch({ type: 'init', blocks: data.spaceBlocks });
    }
    initialized.current = true;
    // The scope.id key is what changes on client→project hop; data.loading
    // changes on first arrival. We deliberately depend only on those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.kind === 'all' ? null : scope.id, data.loading]);

  // Push reducer state out to the server after edits — but only after the
  // initial load has settled so the initial dispatch doesn't double-write.
  useEffect(() => {
    if (!initialized.current) return;
    save(blocks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  // ----- slash menu -----
  const [slash, setSlash] = useState<{ blockId: string; rect: { x: number; y: number } | null } | null>(null);
  const [linkOpen, setLinkOpen] = useState<{ blockId: string } | null>(null);
  const [mentionOpen, setMentionOpen] = useState<{ blockId: string } | null>(null);
  const [embedOpen, setEmbedOpen] = useState<{ blockId: string } | null>(null);

  // ----- block ops -----
  const insertAfter = (afterId: string | null, b?: Partial<SpaceBlock>) => {
    const block: SpaceBlock = { id: blockId(), type: 'text', content: '', ...b };
    dispatch({ type: 'insert', after: afterId, block });
    requestAnimationFrame(() => focusBlock(block.id));
  };
  const removeBlock = (id: string) => {
    if (blocks.length <= 1) return;
    const idx = blocks.findIndex((b) => b.id === id);
    dispatch({ type: 'remove', id });
    const prev = blocks[idx - 1];
    if (prev) requestAnimationFrame(() => focusBlock(prev.id));
  };
  const convertBlock = (id: string, patch: Partial<SpaceBlock>) => {
    dispatch({ type: 'patch', id, patch });
  };
  const setContent = (id: string, content: string) => {
    dispatch({ type: 'patch', id, patch: { content } });
  };

  // ----- slash command handling -----
  const onPickSlash = async (cmd: SlashCommandId) => {
    if (!slash) return;
    const target = blocks.find((b) => b.id === slash.blockId);
    if (!target) {
      setSlash(null);
      return;
    }
    setSlash(null);
    // Strip the trailing "/{query}" from the target's content so the visible
    // text doesn't show the slash residue when the user picks a command.
    const trimmed = (target.content ?? '').replace(/\/[^/\n]*$/, '');
    convertBlock(target.id, { content: trimmed });

    if (cmd === 'h1' || cmd === 'h2' || cmd === 'h3' || cmd === 'text' ||
        cmd === 'bullet' || cmd === 'numbered' || cmd === 'checkbox' ||
        cmd === 'quote' || cmd === 'callout') {
      convertBlock(target.id, { type: cmd });
      requestAnimationFrame(() => focusBlock(target.id));
      return;
    }
    if (cmd === 'divider') {
      convertBlock(target.id, { type: 'divider', content: '' });
      // Always append a fresh text block after a divider so the canvas
      // keeps growing.
      insertAfter(target.id);
      return;
    }
    if (cmd === 'todo') {
      // Convert the current block into a todo placeholder, then create the
      // real to-do async and patch in the resulting id.
      convertBlock(target.id, { type: 'todo', content: 'New to-do' });
      if (!data.clientId) return;
      try {
        const created = await createTodoForBlock(target.id);
        if (created) convertBlock(target.id, { todoId: created.id, content: created.title });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not create to-do');
      }
      return;
    }
    if (cmd === 'goal') {
      convertBlock(target.id, { type: 'goal', content: 'New goal' });
      if (!data.clientId) return;
      try {
        const created = await createGoalForBlock(target.id);
        if (created) convertBlock(target.id, { goalId: created.id, content: created.title });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not create goal');
      }
      return;
    }
    if (cmd === 'timer') {
      const pid = data.projectId
        ?? (data.clientId
          ? (projectsForClient[0]?.id ?? null)
          : null);
      convertBlock(target.id, {
        type: 'timer',
        content: data.project?.name ?? data.client?.name ?? 'Working',
        projectId: pid ?? null,
      });
      return;
    }
    if (cmd === 'link') {
      setLinkOpen({ blockId: target.id });
      return;
    }
    if (cmd === 'mention') {
      setMentionOpen({ blockId: target.id });
      return;
    }
    if (cmd === 'embed') {
      setEmbedOpen({ blockId: target.id });
      return;
    }
  };

  // ----- "create real" helpers -----
  const createTodo = useCreateTodo();
  const createGoal = useCreateGoal();
  const { data: allProjects = [] } = useProjects();
  const projectsForClient = useMemo(
    () => allProjects.filter((p) => p.clientId === data.clientId),
    [allProjects, data.clientId],
  );
  const createTodoForBlock = async (_blockId: string) => {
    if (!data.clientId) return null;
    return createTodo.mutateAsync({
      title: 'New to-do',
      clientId: data.clientId,
      projectId: data.projectId ?? null,
      assigneeId: me?.id ?? null,
      priority: 'medium',
      tags: [],
    });
  };
  const createGoalForBlock = async (_blockId: string) => {
    if (!data.clientId) return null;
    const projectId = data.projectId ?? projectsForClient[0]?.id ?? null;
    if (!projectId) {
      toast.error('Add a project to this client first');
      return null;
    }
    return createGoal.mutateAsync({
      clientId: data.clientId,
      projectId,
      title: 'New goal',
      ownerId: me?.id ?? null,
      priority: 'medium',
      tag: 'Delivery',
      health: 'on-track',
      progress: 0,
    });
  };

  // ----- modal pick handlers -----
  const onLinkPicked = (kind: 'goal' | 'todo' | 'file', refId: string) => {
    if (!linkOpen) return;
    convertBlock(linkOpen.blockId, { type: 'link', linkType: kind, linkRefId: refId, content: '' });
    setLinkOpen(null);
  };
  const onMentionPicked = (name: string) => {
    if (!mentionOpen) return;
    const b = blocks.find((x) => x.id === mentionOpen.blockId);
    if (b) {
      const trimmed = (b.content ?? '').replace(/\/[^/\n]*$/, '');
      convertBlock(b.id, { content: `${trimmed}@${name.split(' ')[0]} ` });
    }
    setMentionOpen(null);
  };
  const onEmbedSubmitted = async (v: EmbedDialogValue) => {
    if (!embedOpen) return;
    const kind = guessEmbedKind(v.url);
    convertBlock(embedOpen.blockId, {
      type: 'embed',
      embedUrl: v.url,
      embedKind: kind,
      content: v.title || v.url,
    });
    // Also register as a Space file with the "from Notes" badge — de-dupe by URL.
    const existing = data.spaceFiles.find((f) => f.url === v.url);
    if (!existing) {
      const f: SpaceFile = {
        id: blockId(),
        kind: kind === 'figma' ? 'figma' : kind === 'github' ? 'github' : kind === 'drive' ? 'drive-doc' : 'link',
        title: v.title || v.url,
        url: v.url,
        meta: 'Embedded from notes',
        source: 'notes',
        addedBy: me?.id ?? '',
        addedAt: new Date().toISOString().slice(0, 10),
      };
      await saveFiles([...data.spaceFiles, f]);
    }
    setEmbedOpen(null);
  };

  if (data.loading || scope.kind === 'all') return null;

  return (
    <div className="max-w-3xl mx-auto">
      {blocks.map((b, i) => (
        <BlockRow
          key={b.id}
          block={b}
          index={i}
          blocks={blocks}
          onRemove={() => removeBlock(b.id)}
          onConvert={(patch) => convertBlock(b.id, patch)}
          onChangeContent={(c) => setContent(b.id, c)}
          onInsertSibling={(typeOverride) =>
            insertAfter(b.id, typeOverride ? { type: typeOverride } : undefined)
          }
          onOpenSlash={(rect) => setSlash({ blockId: b.id, rect })}
        />
      ))}
      <button
        type="button"
        onClick={() => insertAfter(blocks[blocks.length - 1]?.id ?? null)}
        className="w-full text-left text-sm text-gray-400 hover:text-gray-600 py-3 px-2 rounded-lg hover:bg-gray-50"
      >
        Click to write, or press <kbd className="font-mono text-[11px] bg-gray-100 px-1 rounded">/</kbd> for commands…
      </button>

      <SlashMenu
        open={!!slash}
        anchorRect={slash?.rect ?? null}
        onPick={onPickSlash}
        onClose={() => setSlash(null)}
      />
      <LinkPicker
        open={!!linkOpen}
        onClose={() => setLinkOpen(null)}
        onPick={onLinkPicked}
        clientId={data.clientId ?? null}
        projectId={data.projectId ?? null}
        spaceFiles={data.spaceFiles}
      />
      <MentionPicker
        open={!!mentionOpen}
        onClose={() => setMentionOpen(null)}
        onPick={onMentionPicked}
      />
      <EmbedDialog
        open={!!embedOpen}
        onClose={() => setEmbedOpen(null)}
        onSubmit={onEmbedSubmitted}
        intent="embed"
      />
    </div>
  );
}

function focusBlock(id: string) {
  const el = document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
  if (el) {
    el.focus();
    // Move caret to end.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
}

function guessEmbedKind(url: string): 'figma' | 'github' | 'drive' | 'link' {
  try {
    const host = new URL(url).host;
    if (host.includes('figma.com')) return 'figma';
    if (host.includes('github.com')) return 'github';
    if (host.includes('drive.google.com') || host.includes('docs.google.com')) return 'drive';
  } catch {
    /* fallthrough */
  }
  return 'link';
}

// ============================================================================
// BlockRow — gutter handle + per-type body
// ============================================================================

function BlockRow({
  block,
  index,
  blocks,
  onRemove,
  onConvert,
  onChangeContent,
  onInsertSibling,
  onOpenSlash,
}: {
  block: SpaceBlock;
  index: number;
  blocks: SpaceBlock[];
  onRemove: () => void;
  onConvert: (patch: Partial<SpaceBlock>) => void;
  onChangeContent: (c: string) => void;
  onInsertSibling: (typeOverride?: SpaceBlock['type']) => void;
  onOpenSlash: (rect: { x: number; y: number }) => void;
}) {
  return (
    <div className="group relative pl-8 -ml-8 py-0.5">
      <button
        type="button"
        onClick={onRemove}
        title="Remove block"
        className="absolute left-1 top-1.5 opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-600 transition-opacity"
        // Block remove without focusing the gutter so the block keeps focus on rapid edits.
        onMouseDown={(e) => e.preventDefault()}
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
      <BlockBody
        block={block}
        index={index}
        blocks={blocks}
        onConvert={onConvert}
        onChangeContent={onChangeContent}
        onInsertSibling={onInsertSibling}
        onOpenSlash={onOpenSlash}
        onRemove={onRemove}
      />
    </div>
  );
}

function BlockBody(props: {
  block: SpaceBlock;
  index: number;
  blocks: SpaceBlock[];
  onConvert: (patch: Partial<SpaceBlock>) => void;
  onChangeContent: (c: string) => void;
  onInsertSibling: (typeOverride?: SpaceBlock['type']) => void;
  onOpenSlash: (rect: { x: number; y: number }) => void;
  onRemove: () => void;
}) {
  const { block } = props;
  switch (block.type) {
    case 'divider':
      return <hr className="my-3 border-gray-200" />;
    case 'todo':
      return <TodoBlockCard block={block} onConvert={props.onConvert} />;
    case 'goal':
      return <GoalBlockCard block={block} onConvert={props.onConvert} />;
    case 'timer':
      return <TimerBlockCard block={block} onConvert={props.onConvert} />;
    case 'link':
      return <LinkBlockCard block={block} />;
    case 'embed':
      return <EmbedBlockCard block={block} />;
    default:
      return <EditableBlock {...props} />;
  }
}

// ============================================================================
// EditableBlock — text / heading / list / quote / callout
// ============================================================================

function EditableBlock({
  block,
  index,
  blocks,
  onConvert,
  onChangeContent,
  onInsertSibling,
  onOpenSlash,
  onRemove,
}: {
  block: SpaceBlock;
  index: number;
  blocks: SpaceBlock[];
  onConvert: (patch: Partial<SpaceBlock>) => void;
  onChangeContent: (c: string) => void;
  onInsertSibling: (typeOverride?: SpaceBlock['type']) => void;
  onOpenSlash: (rect: { x: number; y: number }) => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Set innerText only on initial mount + on remote/type changes so the
  // caret isn't reset on every keystroke. React state for content lags the
  // DOM here intentionally.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.innerText !== (block.content ?? '')) {
      el.innerText = block.content ?? '';
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id, block.type]);

  const onInput = () => {
    const el = ref.current;
    if (!el) return;
    const text = el.innerText;
    onChangeContent(text);
    // Slash-trigger: if the user typed "/" anywhere, open the menu at caret.
    if (text.endsWith('/')) {
      const rect = caretRect();
      if (rect) onOpenSlash(rect);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const el = ref.current;
    const text = el?.innerText ?? '';

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Demote empty list/heading to text instead of growing the list.
      if (text === '' && (block.type === 'bullet' || block.type === 'numbered' || block.type === 'checkbox')) {
        onConvert({ type: 'text' });
        return;
      }
      // Continue same type for lists; otherwise plain text.
      const sameType = block.type === 'bullet' || block.type === 'numbered' || block.type === 'checkbox';
      onInsertSibling(sameType ? block.type : 'text');
      return;
    }

    if (e.key === 'Backspace' && text === '') {
      if (blocks.length <= 1) return;
      if (block.type !== 'text') {
        e.preventDefault();
        onConvert({ type: 'text' });
        return;
      }
      e.preventDefault();
      onRemove();
      return;
    }
  };

  const cls = blockClassName(block, index, blocks);

  // Prefix prefixing for ordered/unordered/checkbox lists.
  const prefix = (() => {
    if (block.type === 'bullet') return <span className="inline-block w-5 -ml-5 align-top text-gray-400 select-none">•</span>;
    if (block.type === 'numbered') {
      // Count consecutive numbered blocks ending at this index.
      let n = 1;
      for (let i = index - 1; i >= 0; i--) {
        if (blocks[i]!.type === 'numbered') n++;
        else break;
      }
      return <span className="inline-block w-7 -ml-7 align-top text-gray-400 tabular-nums select-none">{n}.</span>;
    }
    if (block.type === 'checkbox') {
      return (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onConvert({ checked: !block.checked });
          }}
          className="inline-flex items-center justify-center w-4 h-4 -ml-6 mr-1 mt-1 rounded border border-gray-300 align-top"
          aria-label={block.checked ? 'Uncheck' : 'Check'}
          onMouseDown={(e) => e.preventDefault()}
        >
          {block.checked && <CheckCircle className="w-3 h-3 text-brand-600" />}
        </button>
      );
    }
    return null;
  })();

  return (
    <div className="flex items-start gap-0">
      {prefix}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-block-id={block.id}
        onInput={onInput}
        onKeyDown={onKeyDown}
        className={cls}
        data-placeholder={placeholderFor(block)}
      />
    </div>
  );
}

function blockClassName(block: SpaceBlock, _i: number, _all: SpaceBlock[]): string {
  const base = 'flex-1 min-w-0 outline-none [&:empty]:before:content-[attr(data-placeholder)] [&:empty]:before:text-gray-300';
  switch (block.type) {
    case 'h1':       return `${base} text-[34px] font-bold tracking-tight leading-tight my-2`;
    case 'h2':       return `${base} text-[26px] font-bold tracking-tight leading-tight my-2`;
    case 'h3':       return `${base} text-[19px] font-bold leading-snug my-2`;
    case 'quote':    return `${base} italic text-gray-700 border-l-4 border-brand-400 pl-3 my-2`;
    case 'callout':  return `${base} bg-brand-50 border border-brand-100 text-brand-900 rounded-xl px-4 py-3 my-2`;
    case 'checkbox': return `${base} text-[15px] leading-relaxed ${block.checked ? 'line-through text-gray-400' : 'text-gray-800'}`;
    default:         return `${base} text-[15px] leading-relaxed text-gray-800`;
  }
}

function placeholderFor(block: SpaceBlock): string {
  switch (block.type) {
    case 'h1':       return 'Heading 1';
    case 'h2':       return 'Heading 2';
    case 'h3':       return 'Heading 3';
    case 'quote':    return 'Quote';
    case 'callout':  return 'Tip or callout';
    case 'bullet':   return 'List item';
    case 'numbered': return 'List item';
    case 'checkbox': return 'Task';
    default:         return "Press '/' for commands";
  }
}

function caretRect(): { x: number; y: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  const rects = range.getClientRects();
  const r = rects[rects.length - 1];
  if (r) return { x: r.left, y: r.bottom };
  // Empty contentEditable — fall back to anchor node's bounding rect.
  const node = sel.anchorNode as HTMLElement | null;
  if (node && node.getBoundingClientRect) {
    const br = node.getBoundingClientRect();
    return { x: br.left, y: br.bottom };
  }
  return null;
}

// ============================================================================
// Specialized block cards
// ============================================================================

function TodoBlockCard({ block, onConvert }: { block: SpaceBlock; onConvert: (p: Partial<SpaceBlock>) => void }) {
  const { data: todos = [] } = useTodos();
  const todo = block.todoId ? todos.find((t) => t.id === block.todoId) : null;
  if (!todo) {
    return (
      <Card>
        <CheckCircle className="w-4 h-4 text-brand-600" />
        <span className="text-sm text-gray-500 italic">Creating to-do…</span>
      </Card>
    );
  }
  const dot = PRIORITY_DOT[todo.priority];
  return (
    <Card>
      <CheckCircle className="w-4 h-4 text-brand-600 shrink-0" />
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dot?.color }} />
      <span className={`flex-1 min-w-0 text-sm ${todo.status === 'done' ? 'line-through text-gray-400' : 'text-gray-800'}`}>
        {todo.title}
      </span>
      <AutoLink />
    </Card>
  );
}

function GoalBlockCard({ block, onConvert }: { block: SpaceBlock; onConvert: (p: Partial<SpaceBlock>) => void }) {
  const { data: goals = [] } = useGoals();
  const { data: todos = [] } = useTodos();
  const goal = block.goalId ? goals.find((g) => g.id === block.goalId) : null;
  if (!goal) {
    return (
      <Card>
        <Target className="w-4 h-4 text-brand-600" />
        <span className="text-sm text-gray-500 italic">Creating goal…</span>
      </Card>
    );
  }
  const pct = rollupProgress(goal, todos);
  return (
    <Card>
      <Target className="w-4 h-4 text-brand-600 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-gray-900 truncate">{goal.title}</div>
        <div className="mt-1 h-1 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-brand-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <AutoLink />
    </Card>
  );
}

function TimerBlockCard({ block, onConvert }: { block: SpaceBlock; onConvert: (p: Partial<SpaceBlock>) => void }) {
  const start = useStartTimer();
  const stop = useStopTimer();
  const { timer, elapsedSec } = useMyTimer();
  const toast = useToast();
  const running = timer?.spaceBlockId === block.id;
  const onClick = async () => {
    try {
      if (running) {
        await stop.mutateAsync();
      } else {
        await start.mutateAsync({
          projectId: block.projectId ?? null,
          note: block.content || 'Working',
          spaceBlockId: block.id,
        });
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Timer action failed');
    }
  };
  return (
    <Card className={running ? 'bg-red-50 border-red-300' : undefined}>
      <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
      <input
        value={block.content ?? ''}
        onChange={(e) => onConvert({ content: e.target.value })}
        placeholder="What are you working on?"
        className="flex-1 min-w-0 bg-transparent outline-none text-sm text-gray-800 placeholder:text-gray-400"
      />
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-1 transition-colors ${
          running ? 'bg-red-600 text-white hover:bg-red-700' : 'border border-gray-200 text-gray-600 hover:bg-brand-50 hover:text-brand-700 hover:border-brand-200'
        }`}
      >
        {running ? <><Square className="w-3 h-3" /><span className="font-mono tabular-nums">{fmtTimer(elapsedSec)}</span> Stop</>
         : <><Play className="w-3 h-3" /> Start</>}
      </button>
    </Card>
  );
}

function LinkBlockCard({ block }: { block: SpaceBlock }) {
  const { data: goals = [] } = useGoals();
  const { data: todos = [] } = useTodos();
  if (!block.linkRefId || !block.linkType) {
    return <Card><LinkIcon className="w-4 h-4 text-gray-400" /><span className="text-sm text-gray-500 italic">Pick a link target</span></Card>;
  }
  let label = block.linkRefId;
  if (block.linkType === 'goal') {
    const g = goals.find((x) => x.id === block.linkRefId);
    if (g) label = g.title;
  } else if (block.linkType === 'todo') {
    const t = todos.find((x) => x.id === block.linkRefId);
    if (t) label = t.title;
  }
  const Icon = block.linkType === 'goal' ? Target : block.linkType === 'todo' ? CheckCircle : LinkIcon;
  return (
    <Card>
      <Icon className="w-4 h-4 text-brand-600 shrink-0" />
      <span className="flex-1 min-w-0 text-sm text-gray-800 truncate">{label}</span>
      <span className="text-[10px] uppercase font-bold tracking-wide bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">{block.linkType}</span>
    </Card>
  );
}

function EmbedBlockCard({ block }: { block: SpaceBlock }) {
  const Icon = EmbedIcon;
  return (
    <Card>
      <Icon className="w-4 h-4 text-brand-600 shrink-0" />
      <a
        href={block.embedUrl}
        target="_blank"
        rel="noreferrer"
        className="flex-1 min-w-0 text-sm text-gray-800 truncate hover:text-brand-700"
        title={block.embedUrl}
      >
        {block.content || block.embedUrl}
      </a>
      <span className="text-[10px] uppercase font-bold tracking-wide bg-brand-100 text-brand-800 rounded px-1.5 py-0.5">{block.embedKind ?? 'link'}</span>
      <ExternalLink className="w-3.5 h-3.5 text-gray-400" />
    </Card>
  );
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`my-1.5 flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 ${className ?? 'bg-white'}`}>
      {children}
    </div>
  );
}

function AutoLink() {
  return <span className="text-[10px] italic text-gray-400 ml-1">Auto-linked</span>;
}
