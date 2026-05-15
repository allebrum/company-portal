'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import {
  useAddManualEntry,
  useUpdateEntry,
  useDeleteEntry,
  useClients,
  useProjects,
  type EntryRow,
} from '@/hooks/useResources';

export function EntryFormModal({
  open,
  onClose,
  entry,
}: {
  open: boolean;
  onClose: () => void;
  entry?: EntryRow | null;
}) {
  const isEdit = !!entry;
  const toast = useToast();
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();
  const add = useAddManualEntry();
  const update = useUpdateEntry();
  const del = useDeleteEntry();

  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [durationMin, setDurationMin] = useState(60);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    if (entry) {
      const proj = projects.find((p) => p.id === entry.projectId);
      setClientId(proj?.clientId ?? '');
      setProjectId(entry.projectId);
      setDate(entry.startIso.slice(0, 10));
      setDurationMin(entry.durationMin);
      setNote(entry.note);
    } else {
      setClientId('');
      setProjectId('');
      setDate(new Date().toISOString().slice(0, 10));
      setDurationMin(60);
      setNote('');
    }
  }, [open, entry, projects]);

  const projectsForClient = projects.filter((p) => p.clientId === clientId);
  const isDraft = entry?.status === 'draft';

  const onSave = async () => {
    if (!projectId) {
      toast.error('Pick a project');
      return;
    }
    const startIso = new Date(`${date}T09:00:00`).toISOString();
    try {
      if (isEdit && entry) {
        await update.mutateAsync({
          id: entry.id,
          patch: { projectId, note, startIso, durationMin },
        });
        toast.success('Entry updated');
      } else {
        await add.mutateAsync({ projectId, note: note || 'Manual entry', startIso, durationMin, todoId: null });
        toast.success('Entry added');
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const onDelete = async () => {
    if (!entry) return;
    try {
      await del.mutateAsync(entry.id);
      toast.success('Entry deleted');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  };

  const busy = add.isPending || update.isPending || del.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit time entry' : 'Add manual entry'}
      size="md"
      footer={
        <>
          {isEdit && isDraft && (
            <Button variant="danger" onClick={onDelete} disabled={busy} className="mr-auto">
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onSave} disabled={!projectId || busy}>
            {isEdit ? 'Save changes' : 'Add entry'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {entry?.status === 'rejected' && entry.rejectionNote && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            <span className="font-semibold">Returned: </span>
            {entry.rejectionNote}
          </div>
        )}
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Duration (min)"><Input type="number" min={1} value={durationMin} onChange={(e) => setDurationMin(Number(e.target.value) || 0)} /></Field>
        </div>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you do?" /></Field>
      </div>
    </Modal>
  );
}
