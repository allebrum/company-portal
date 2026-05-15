'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Checkbox } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { Play, Square } from 'lucide-react';
import {
  useCreateTodo,
  useUpdateTodo,
  useUsers,
  useClients,
  useProjects,
  useGoals,
  useStartTimer,
  useStopTimer,
  type TodoRow,
} from '@/hooks/useResources';
import { useMyTimer } from '@/hooks/useTimer';
import { fmtTimer } from '@/lib/formatters';
import { useAuth } from '@/hooks/useAuth';

export function TodoFormModal({
  open,
  onClose,
  todo,
}: {
  open: boolean;
  onClose: () => void;
  todo?: TodoRow | null;
}) {
  const isEdit = !!todo;
  const { me } = useAuth();
  const toast = useToast();
  const { data: users = [] } = useUsers();
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();
  const { data: goals = [] } = useGoals();
  const create = useCreateTodo();
  const update = useUpdateTodo();
  const startTimer = useStartTimer();
  const stopTimer = useStopTimer();
  const { timer: myTimer, elapsedSec } = useMyTimer();
  const timerOnThis = isEdit && todo ? myTimer?.todoId === todo.id : false;

  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [goalId, setGoalId] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [estimateMin, setEstimateMin] = useState(60);
  const [loggedMin, setLoggedMin] = useState(0);
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [priv, setPriv] = useState(false);
  const [status, setStatus] = useState<'open' | 'done'>('open');

  useEffect(() => {
    if (!open) return;
    if (todo) {
      setTitle(todo.title);
      setAssigneeId(todo.assigneeId ?? '');
      setClientId(todo.clientId ?? '');
      setProjectId(todo.projectId ?? '');
      setGoalId(todo.goalId ?? '');
      setPriority(todo.priority);
      setEstimateMin(todo.estimateMin);
      setLoggedMin(todo.loggedMin);
      setDueDate(todo.dueDate ?? new Date().toISOString().slice(0, 10));
      setPriv(todo.private);
      setStatus(todo.status);
    } else {
      setTitle('');
      setAssigneeId(me?.id ?? '');
      setClientId('');
      setProjectId('');
      setGoalId('');
      setPriority('medium');
      setEstimateMin(60);
      setLoggedMin(0);
      setDueDate(new Date().toISOString().slice(0, 10));
      setPriv(false);
      setStatus('open');
    }
  }, [open, todo, me]);

  const projectsForClient = projects.filter((p) => p.clientId === clientId);
  const goalsForProject = goals.filter((g) => g.projectId === projectId);

  const onSave = async () => {
    if (!title.trim()) return;
    try {
      if (isEdit && todo) {
        await update.mutateAsync({
          id: todo.id,
          patch: {
            title: title.trim(),
            assigneeId: assigneeId || null,
            clientId: clientId || null,
            projectId: projectId || null,
            goalId: goalId || null,
            priority,
            estimateMin,
            loggedMin,
            dueDate,
            private: priv,
            status,
          },
        });
        toast.success('To-do updated');
      } else {
        await create.mutateAsync({
          title: title.trim(),
          assigneeId: assigneeId || me?.id || null,
          clientId: clientId || null,
          projectId: projectId || null,
          goalId: goalId || null,
          priority,
          estimateMin,
          dueDate,
          tags: [],
          private: priv,
        });
        toast.success('To-do created');
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const busy = create.isPending || update.isPending;

  const onToggleTimer = async () => {
    if (!todo) return;
    try {
      if (timerOnThis) {
        await stopTimer.mutateAsync();
        toast.success('Timer stopped');
      } else {
        if (!todo.projectId) {
          toast.error('Add a project to this to-do to track time');
          return;
        }
        await startTimer.mutateAsync({ projectId: todo.projectId, note: todo.title, todoId: todo.id });
        toast.success(`Timer started — ${todo.title}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Timer action failed');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit to-do' : 'New to-do'}
      size="md"
      footer={
        <>
          {isEdit && todo && todo.status !== 'done' && (
            timerOnThis ? (
              <Button variant="danger" onClick={onToggleTimer} className="mr-auto">
                <Square className="w-4 h-4" />
                <span className="font-mono tabular-nums">{fmtTimer(elapsedSec)}</span> Stop
              </Button>
            ) : (
              <Button
                variant="outline"
                onClick={onToggleTimer}
                disabled={!todo.projectId || startTimer.isPending}
                className="mr-auto"
                title={todo.projectId ? 'Start timer for this task' : 'Add a project to this to-do to track time'}
              >
                <Play className="w-4 h-4" /> Start timer
              </Button>
            )
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onSave} disabled={!title.trim() || busy}>
            {isEdit ? 'Save changes' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Assignee">
            <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Me</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high')}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client">
            <Select value={clientId} onChange={(e) => { setClientId(e.target.value); setProjectId(''); setGoalId(''); }}>
              <option value="">—</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Project">
            <Select value={projectId} onChange={(e) => { setProjectId(e.target.value); setGoalId(''); }} disabled={!clientId}>
              <option value="">—</option>
              {projectsForClient.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Goal (optional)">
          <Select value={goalId} onChange={(e) => setGoalId(e.target.value)} disabled={!projectId}>
            <option value="">—</option>
            {goalsForProject.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Due date"><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>
          <Field label="Estimate (min)"><Input type="number" min={0} value={estimateMin} onChange={(e) => setEstimateMin(Number(e.target.value) || 0)} /></Field>
        </div>
        {isEdit && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Logged (min)"><Input type="number" min={0} value={loggedMin} onChange={(e) => setLoggedMin(Number(e.target.value) || 0)} /></Field>
            <Field label="Status">
              <Select value={status} onChange={(e) => setStatus(e.target.value as 'open' | 'done')}>
                <option value="open">Open</option>
                <option value="done">Done</option>
              </Select>
            </Field>
          </div>
        )}
        <Checkbox label="Private (only visible to assignee)" checked={priv} onChange={setPriv} />
      </div>
    </Modal>
  );
}
