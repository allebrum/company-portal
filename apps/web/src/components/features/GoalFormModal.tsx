'use client';

import { useEffect, useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import {
  useCreateGoal,
  useUpdateGoal,
  useAddResource,
  useRemoveResource,
  useUsers,
  useClients,
  useProjects,
  type GoalRow,
} from '@/hooks/useResources';
import type { ResourceKind } from '@allebrum/shared';

const STATUSES: { value: GoalRow['status']; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'in-progress', label: 'In progress' },
  { value: 'review', label: 'In review' },
  { value: 'done', label: 'Shipped' },
];

export function GoalFormModal({
  open,
  onClose,
  goal,
}: {
  open: boolean;
  onClose: () => void;
  goal?: GoalRow | null;
}) {
  const isEdit = !!goal;
  const toast = useToast();
  const { data: users = [] } = useUsers();
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();
  const create = useCreateGoal();
  const update = useUpdateGoal();
  const addRes = useAddResource();
  const removeRes = useRemoveResource();

  const [title, setTitle] = useState('');
  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [status, setStatus] = useState<GoalRow['status']>('backlog');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [tag, setTag] = useState('Delivery');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [rKind, setRKind] = useState<ResourceKind>('link');
  const [rTitle, setRTitle] = useState('');
  const [rUrl, setRUrl] = useState('');
  const [rMeta, setRMeta] = useState('');

  useEffect(() => {
    if (!open) return;
    if (goal) {
      setTitle(goal.title);
      setClientId(goal.clientId);
      setProjectId(goal.projectId);
      setOwnerId(goal.ownerId ?? '');
      setStatus(goal.status);
      setPriority(goal.priority);
      setTag(goal.tag);
      setStartDate(goal.startDate ?? '');
      setEndDate(goal.endDate ?? '');
    } else {
      setTitle('');
      setClientId('');
      setProjectId('');
      setOwnerId('');
      setStatus('backlog');
      setPriority('medium');
      setTag('Delivery');
      setStartDate('');
      setEndDate('');
    }
  }, [open, goal]);

  const projectsForClient = projects.filter((p) => p.clientId === clientId);

  const onSave = async () => {
    if (!title.trim() || !clientId || !projectId) {
      toast.error('Title, client and project are required');
      return;
    }
    try {
      const payload = {
        clientId,
        projectId,
        title: title.trim(),
        status,
        ownerId: ownerId || null,
        priority,
        tag,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };
      if (isEdit && goal) {
        await update.mutateAsync({ id: goal.id, patch: payload });
        toast.success('Goal updated');
      } else {
        await create.mutateAsync(payload);
        toast.success('Goal created');
        onClose();
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const onAddRes = async () => {
    if (!goal || !rTitle.trim()) return;
    try {
      await addRes.mutateAsync({ goalId: goal.id, input: { kind: rKind, title: rTitle.trim(), url: rUrl, meta: rMeta } });
      toast.success('Resource attached');
      setRTitle('');
      setRUrl('');
      setRMeta('');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to attach');
    }
  };

  const busy = create.isPending || update.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit goal' : 'New goal'}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={onSave} disabled={busy}>
            {isEdit ? 'Save changes' : 'Create goal'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Goal title" autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Client">
            <Select value={clientId} onChange={(e) => { setClientId(e.target.value); setProjectId(''); }}>
              <option value="">— Pick a client —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Project">
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={!clientId}>
              <option value="">— Pick a project —</option>
              {projectsForClient.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Owner">
            <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as GoalRow['status'])}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as 'low' | 'medium' | 'high')}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </Field>
          <Field label="Start"><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></Field>
          <Field label="End"><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
        </div>
        <Field label="Tag"><Input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Delivery, Ops, Growth…" /></Field>

        {isEdit && goal && (
          <div className="pt-2 border-t border-gray-100">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Resources</div>
            <ul className="space-y-1 mb-3">
              {goal.resources.length === 0 && <li className="text-sm text-gray-500">No resources yet.</li>}
              {goal.resources.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">{r.title} <span className="text-gray-400">({r.kind})</span></span>
                  <button
                    onClick={async () => {
                      try {
                        await removeRes.mutateAsync({ goalId: goal.id, resourceId: r.id });
                        toast.success('Resource removed');
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Failed');
                      }
                    }}
                    className="text-gray-300 hover:text-red-600"
                    title="Remove"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="grid grid-cols-2 gap-2">
              <Select value={rKind} onChange={(e) => setRKind(e.target.value as ResourceKind)}>
                <option value="link">Web link</option>
                <option value="figma">Figma file</option>
                <option value="drive-doc">Google Doc</option>
                <option value="drive-sheet">Google Sheet</option>
                <option value="drive-folder">Drive folder</option>
                <option value="github">GitHub</option>
                <option value="key">Encrypted key</option>
                <option value="note">Note</option>
              </Select>
              <Input value={rTitle} onChange={(e) => setRTitle(e.target.value)} placeholder="Title" />
              <Input value={rUrl} onChange={(e) => setRUrl(e.target.value)} placeholder="URL" />
              <Input value={rMeta} onChange={(e) => setRMeta(e.target.value)} placeholder="Meta (optional)" />
            </div>
            <div className="mt-2">
              <Button variant="outline" size="sm" onClick={onAddRes} disabled={!rTitle.trim() || addRes.isPending}>
                <Plus className="w-4 h-4" /> Attach resource
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
