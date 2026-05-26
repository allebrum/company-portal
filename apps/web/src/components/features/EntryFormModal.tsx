'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { fmtMins } from '@/lib/formatters';
import {
  useAddManualEntry,
  useUpdateEntry,
  useDeleteEntry,
  useClients,
  useProjects,
  type EntryRow,
} from '@/hooks/useResources';

// ISO (UTC) -> value for <input type="datetime-local"> (local wall time, no tz)
function isoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
// datetime-local value (local wall time) -> ISO string
function localInputToIso(local: string): string {
  return new Date(local).toISOString();
}
function defaultStart(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  return isoToLocalInput(d.toISOString());
}
function plusHours(local: string, hours: number): string {
  const d = new Date(local);
  d.setHours(d.getHours() + hours);
  return isoToLocalInput(d.toISOString());
}

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
  const [start, setStart] = useState(defaultStart());
  const [end, setEnd] = useState(plusHours(defaultStart(), 1));
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) return;
    if (entry) {
      const proj = projects.find((p) => p.id === entry.projectId);
      setClientId(proj?.clientId ?? '');
      // entry.projectId may be null (project-less entry); the empty string
      // is the "no selection" sentinel for the <Select> below.
      setProjectId(entry.projectId ?? '');
      const s = isoToLocalInput(entry.startIso);
      setStart(s);
      setEnd(
        entry.endIso
          ? isoToLocalInput(entry.endIso)
          : isoToLocalInput(new Date(new Date(entry.startIso).getTime() + entry.durationMin * 60000).toISOString()),
      );
      setNote(entry.note);
    } else {
      const s = defaultStart();
      setClientId('');
      setProjectId('');
      setStart(s);
      setEnd(plusHours(s, 1));
      setNote('');
    }
  }, [open, entry, projects]);

  const projectsForClient = projects.filter((p) => p.clientId === clientId);
  const isDraft = entry?.status === 'draft';

  const durationMin = useMemo(() => {
    const ms = new Date(end).getTime() - new Date(start).getTime();
    return Math.round(ms / 60000);
  }, [start, end]);
  const durationValid = durationMin > 0 && durationMin <= 24 * 60;

  const onSave = async () => {
    if (!durationValid) {
      toast.error(durationMin <= 0 ? 'End must be after start' : 'Entry cannot exceed 24 hours');
      return;
    }
    const startIso = localInputToIso(start);
    const endIso = localInputToIso(end);
    // Project is optional now — empty string = no project picked.
    const pid = projectId || null;
    try {
      if (isEdit && entry) {
        await update.mutateAsync({ id: entry.id, patch: { projectId: pid, note, startIso, endIso } });
        toast.success('Entry updated');
      } else {
        await add.mutateAsync({ projectId: pid, note: note || 'Manual entry', startIso, endIso, todoId: null });
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
          <Button variant="primary" onClick={onSave} disabled={!durationValid || busy}>
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
          <Field label="Start">
            <Input
              type="datetime-local"
              value={start}
              onChange={(e) => {
                const v = e.target.value;
                setStart(v);
                if (new Date(end).getTime() <= new Date(v).getTime()) setEnd(plusHours(v, 1));
              }}
            />
          </Field>
          <Field label="End">
            <Input type="datetime-local" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <div className={`text-sm ${durationValid ? 'text-gray-600' : 'text-red-600'}`}>
          Duration:{' '}
          <span className="font-semibold tabular-nums">
            {durationValid ? fmtMins(durationMin) : durationMin <= 0 ? 'end must be after start' : 'exceeds 24h'}
          </span>
        </div>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What did you do?" /></Field>
      </div>
    </Modal>
  );
}
