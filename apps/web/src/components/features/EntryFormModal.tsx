'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { fmtMins } from '@/lib/formatters';
import {
  useAddManualEntry,
  useUpdateEntry,
  useDeleteEntry,
  useClients,
  useProjects,
  useUsers,
  type EntryRow,
} from '@/hooks/useResources';
import { useAuth } from '@/hooks/useAuth';

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
  const confirmDialog = useConfirm();
  const { me, can } = useAuth();
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();
  const { data: users = [] } = useUsers();
  const add = useAddManualEntry();
  const update = useUpdateEntry();
  const del = useDeleteEntry();

  const [clientId, setClientId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [start, setStart] = useState(defaultStart());
  const [end, setEnd] = useState(plusHours(defaultStart(), 1));
  const [note, setNote] = useState('');
  // Admins with `time_entry.edit` can log time on behalf of a teammate —
  // the entry lands as that user's draft. Everyone else logs for themselves.
  const canLogForOthers = can('time_entry.edit');
  const [forUserId, setForUserId] = useState('');

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
      setForUserId('');
    }
  }, [open, entry, projects]);

  const projectsForClient = projects.filter((p) => p.clientId === clientId);
  const isDraft = entry?.status === 'draft';
  // Field-edit policy: only `draft` and `rejected` (the user is fixing
  // returned work) accept patches. Submitted / approved entries are
  // read-only at the field level — but the Delete button is always
  // available so the user can withdraw the entry entirely.
  const fieldsEditable = !isEdit || isDraft || entry?.status === 'rejected';

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
        const onBehalf = canLogForOthers && forUserId && forUserId !== me?.id;
        await add.mutateAsync({
          projectId: pid,
          note: note || 'Manual entry',
          startIso,
          endIso,
          todoId: null,
          ...(onBehalf ? { userId: forUserId } : {}),
        });
        toast.success(
          onBehalf
            ? `Entry added for ${users.find((u) => u.id === forUserId)?.name ?? 'teammate'}`
            : 'Entry added',
        );
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const onDelete = async () => {
    if (!entry) return;
    // Soft confirm for non-draft entries. Drafts are routinely deleted
    // while logging; submitted/approved entries are workflow actions
    // worth a second click before the row goes away.
    if (entry.status !== 'draft') {
      const ok = await confirmDialog({
        title: `Delete this ${entry.status} entry?`,
        body: 'It will be removed from any pay-period totals and approval queues.',
        confirmLabel: 'Delete entry',
      });
      if (!ok) return;
    }
    try {
      await del.mutateAsync(entry.id);
      toast.success('Entry deleted');
      onClose();
    } catch (e) {
      // Surface the closed-period guard with a friendlier message than
      // the raw 409 code.
      const msg =
        e instanceof Error && /entry_in_closed_period/.test(e.message)
          ? 'This entry is in a closed pay period and can’t be deleted. Ask an admin to reopen the period first.'
          : e instanceof Error
            ? e.message
            : 'Delete failed';
      toast.error(msg);
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
          {isEdit && (
            <Button
              variant="danger"
              onClick={onDelete}
              disabled={busy}
              className="mr-auto"
              title={
                isDraft
                  ? 'Delete this draft entry'
                  : 'Delete this entry. It will be removed from pay-period totals and approval queues.'
              }
            >
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>{fieldsEditable ? 'Cancel' : 'Close'}</Button>
          {fieldsEditable && (
            <Button variant="primary" onClick={onSave} disabled={!durationValid || busy}>
              {isEdit ? 'Save changes' : 'Add entry'}
            </Button>
          )}
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
        {isEdit && !fieldsEditable && (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800">
            This entry has been {entry?.status}. Fields are read-only; use Delete below if you need to retract it.
          </div>
        )}
        {!isEdit && canLogForOthers && (
          <Field label="Log time for" hint="The entry lands as their draft, exactly as if they logged it.">
            <Select value={forUserId} onChange={(e) => setForUserId(e.target.value)}>
              <option value="">Me{me ? ` (${me.name})` : ''}</option>
              {users
                .filter((u) => u.id !== me?.id && u.status === 'active')
                .map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Client">
          <Select
            value={clientId}
            onChange={(e) => { setClientId(e.target.value); setProjectId(''); }}
            disabled={!fieldsEditable}
          >
            <option value="">— Pick a client —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Project">
          <Select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            disabled={!fieldsEditable || !clientId}
          >
            <option value="">— Pick a project —</option>
            {projectsForClient.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <Input
              type="datetime-local"
              value={start}
              disabled={!fieldsEditable}
              onChange={(e) => {
                const v = e.target.value;
                setStart(v);
                if (new Date(end).getTime() <= new Date(v).getTime()) setEnd(plusHours(v, 1));
              }}
            />
          </Field>
          <Field label="End">
            <Input
              type="datetime-local"
              value={end}
              min={start}
              disabled={!fieldsEditable}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <div className={`text-sm ${durationValid ? 'text-gray-600' : 'text-red-600'}`}>
            Duration:{' '}
            <span className="font-semibold tabular-nums">
              {durationValid ? fmtMins(durationMin) : durationMin <= 0 ? 'end must be after start' : 'exceeds 24h'}
            </span>
          </div>
          <div className="text-[11px] text-gray-500">
            Times are local ({Intl.DateTimeFormat().resolvedOptions().timeZone})
          </div>
        </div>
        <Field label="Note">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did you do?"
            disabled={!fieldsEditable}
          />
        </Field>
      </div>
    </Modal>
  );
}
