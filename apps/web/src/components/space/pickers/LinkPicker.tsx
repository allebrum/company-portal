'use client';

import { useEffect, useMemo, useState } from 'react';
import { Target, CheckCircle, Link as LinkIcon } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Field';
import { useGoals, useTodos } from '@/hooks/useResources';
import type { SpaceFile } from '@allebrum/shared';

/**
 * Modal picker for the `/link` slash command. Lists every in-scope goal,
 * to-do, and Space file with a single text filter. The pick callback hands
 * the new `link` block its type + target id.
 *
 * Scoping rules:
 *  - When `projectId` is set, only items belonging to that project show up.
 *  - When only `clientId` is set, everything for that client (across its
 *    projects) shows up. Files are always all of the Space's files.
 */
export function LinkPicker({
  open,
  onClose,
  onPick,
  clientId,
  projectId,
  spaceFiles,
}: {
  open: boolean;
  onClose: () => void;
  onPick: (kind: 'goal' | 'todo' | 'file', refId: string) => void;
  clientId: string | null;
  projectId: string | null;
  spaceFiles: SpaceFile[];
}) {
  const { data: goals = [] } = useGoals();
  const { data: todos = [] } = useTodos();
  const [q, setQ] = useState('');

  useEffect(() => {
    if (open) {
      setQ('');
      document.body.setAttribute('data-space-modal-open', '1');
    } else {
      document.body.removeAttribute('data-space-modal-open');
    }
    return () => document.body.removeAttribute('data-space-modal-open');
  }, [open]);

  const filteredGoals = useMemo(() => {
    const list = goals.filter((g) =>
      projectId ? g.projectId === projectId : clientId ? g.clientId === clientId : false,
    );
    if (!q) return list;
    const needle = q.toLowerCase();
    return list.filter((g) => g.title.toLowerCase().includes(needle));
  }, [goals, projectId, clientId, q]);

  const filteredTodos = useMemo(() => {
    const list = todos.filter((t) =>
      projectId ? t.projectId === projectId : clientId ? t.clientId === clientId : false,
    );
    if (!q) return list;
    const needle = q.toLowerCase();
    return list.filter((t) => t.title.toLowerCase().includes(needle));
  }, [todos, projectId, clientId, q]);

  const filteredFiles = useMemo(() => {
    if (!q) return spaceFiles;
    const needle = q.toLowerCase();
    return spaceFiles.filter((f) => f.title.toLowerCase().includes(needle));
  }, [spaceFiles, q]);

  return (
    <Modal open={open} onClose={onClose} title="Link to an item" size="md">
      <div className="space-y-3">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter goals, to-dos, files…"
          autoFocus
        />
        <div className="max-h-80 overflow-y-auto space-y-3">
          <PickGroup label="Goals" icon={Target} empty="No goals in scope.">
            {filteredGoals.map((g) => (
              <PickRow
                key={g.id}
                icon={Target}
                title={g.title}
                meta={g.status}
                onClick={() => onPick('goal', g.id)}
              />
            ))}
          </PickGroup>
          <PickGroup label="To-dos" icon={CheckCircle} empty="No to-dos in scope.">
            {filteredTodos.map((t) => (
              <PickRow
                key={t.id}
                icon={CheckCircle}
                title={t.title}
                meta={t.status}
                onClick={() => onPick('todo', t.id)}
              />
            ))}
          </PickGroup>
          <PickGroup label="Files" icon={LinkIcon} empty="No files attached to this Space yet.">
            {filteredFiles.map((f) => (
              <PickRow
                key={f.id}
                icon={LinkIcon}
                title={f.title}
                meta={f.kind}
                onClick={() => onPick('file', f.id)}
              />
            ))}
          </PickGroup>
        </div>
      </div>
    </Modal>
  );
}

function PickGroup({
  label,
  icon: Icon,
  empty,
  children,
}: {
  label: string;
  icon: typeof Target;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest font-bold text-gray-400 mb-1 flex items-center gap-1.5">
        <Icon className="w-3 h-3" />
        {label}
      </div>
      {items.length === 0 ? (
        <div className="text-[12px] text-gray-400 px-1 pb-1">{empty}</div>
      ) : (
        <div className="space-y-0.5">{children}</div>
      )}
    </div>
  );
}

function PickRow({
  icon: Icon,
  title,
  meta,
  onClick,
}: {
  icon: typeof Target;
  title: string;
  meta?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-brand-50 text-left"
    >
      <Icon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      <span className="flex-1 min-w-0 text-sm text-gray-800 truncate">{title}</span>
      {meta && (
        <span className="text-[10px] uppercase font-bold tracking-wide bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">{meta}</span>
      )}
    </button>
  );
}
