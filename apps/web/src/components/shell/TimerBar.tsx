'use client';

import { useEffect, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Field, Input, Select } from '../ui/Field';
import { useMyTimer } from '@/hooks/useTimer';
import { useClients, useProjects, useTodos, useStartTimer, useStopTimer } from '@/hooks/useResources';
import { fmtTimer } from '@/lib/formatters';

export function TimerBar() {
  const { timer, elapsedSec } = useMyTimer();
  const start = useStartTimer();
  const stop = useStopTimer();
  const { data: clients } = useClients();
  const { data: projects } = useProjects();
  const { data: todos } = useTodos();

  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [todoId, setTodoId] = useState<string>('');
  const [note, setNote] = useState<string>('');

  // Initialize defaults once data lands
  useEffect(() => {
    if (clients && clients.length > 0 && !clientId) {
      setClientId(clients[0]!.id);
    }
  }, [clients, clientId]);
  useEffect(() => {
    if (!clientId || !projects) return;
    const first = projects.find((p) => p.clientId === clientId);
    setProjectId(first?.id ?? '');
  }, [clientId, projects]);

  // Keyboard shortcut: Cmd/Ctrl+Shift+T opens picker
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key.toLowerCase() !== 't') return;
      e.preventDefault();
      if (!timer) setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [timer]);

  const activeProject = timer ? projects?.find((p) => p.id === timer.projectId) : null;
  const activeClient = activeProject ? clients?.find((c) => c.id === activeProject.clientId) : null;
  const clientProjects = (projects ?? []).filter((p) => p.clientId === clientId);
  const filteredTodos = (todos ?? []).filter((t) => t.status !== 'done' && (!projectId || t.projectId === projectId));

  const onStart = async () => {
    if (!projectId) return;
    await start.mutateAsync({
      projectId,
      note: note || filteredTodos.find((t) => t.id === todoId)?.title || 'Working',
      todoId: todoId || null,
    });
    setOpen(false);
    setNote('');
    setTodoId('');
  };

  return (
    <div className={`sticky top-0 z-40 backdrop-blur-md ${timer ? 'bg-brand-700/95 text-white' : 'bg-white/90 border-b border-gray-200'}`}>
      <div className="px-6 h-14 flex items-center gap-4">
        <div className="flex-1" />
        {timer ? (
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex flex-col items-end leading-tight">
              <div className="text-[11px] uppercase tracking-widest text-brand-200/90 font-semibold">
                Tracking · {activeClient?.name ?? ''}
              </div>
              <div className="text-sm font-semibold truncate max-w-[300px]">
                {activeProject?.name ?? ''} <span className="text-brand-200/80">— {timer.note}</span>
              </div>
            </div>
            <div className="font-mono text-lg font-bold tabular-nums bg-white/15 px-3 py-1 rounded-lg">{fmtTimer(elapsedSec)}</div>
            <Button variant="danger" onClick={() => stop.mutate()} className="shadow-md">
              <Square className="w-4 h-4" /> Stop
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-gray-500">No timer running</span>
            <Button variant="primary" onClick={() => setOpen(true)} className="shadow-md">
              <Play className="w-4 h-4" /> Start timer
            </Button>
          </div>
        )}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Start timer"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={onStart} disabled={!projectId || start.isPending}>
              <Play className="w-4 h-4" /> Start
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Client">
            <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
              {(clients ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Project">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— Pick a project —</option>
              {clientProjects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Link to a to-do (optional)">
            <Select
              value={todoId}
              onChange={(e) => {
                setTodoId(e.target.value);
                const t = (todos ?? []).find((x) => x.id === e.target.value);
                if (t) setNote(t.title);
              }}
            >
              <option value="">— none —</option>
              {filteredTodos.map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </Select>
          </Field>
          <Field label="Note" hint="What are you working on right now?">
            <Input
              placeholder="e.g. Reviewing accessibility audit findings"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
