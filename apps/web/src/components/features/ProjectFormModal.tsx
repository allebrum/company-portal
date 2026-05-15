'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Checkbox } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import {
  useCreateProject,
  useUpdateProject,
  useClients,
  type ProjectRow,
} from '@/hooks/useResources';

export function ProjectFormModal({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project?: ProjectRow | null;
}) {
  const isEdit = !!project;
  const toast = useToast();
  const { data: clients = [] } = useClients();
  const create = useCreateProject();
  const update = useUpdateProject();

  const [clientId, setClientId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [budgetHrs, setBudgetHrs] = useState(120);
  const [billable, setBillable] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (project) {
      setClientId(project.clientId);
      setName(project.name);
      setCode(project.code);
      setBudgetHrs(project.budgetHrs);
      setBillable(project.billable);
    } else {
      setClientId('');
      setName('');
      setCode('');
      setBudgetHrs(120);
      setBillable(true);
    }
  }, [open, project]);

  const onSave = async () => {
    if (!name.trim() || !clientId) {
      toast.error('Client and name are required');
      return;
    }
    try {
      if (isEdit && project) {
        await update.mutateAsync({
          id: project.id,
          patch: { clientId, name: name.trim(), code, budgetHrs, billable },
        });
        toast.success('Project updated');
      } else {
        await create.mutateAsync({ clientId, name: name.trim(), code, budgetHrs, billable, color: '#9333ea' });
        toast.success('Project created');
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const busy = create.isPending || update.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit project' : 'Add project'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onSave} disabled={!name.trim() || !clientId || busy}>
            {isEdit ? 'Save changes' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Client">
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— Pick a client —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. CDT-GG" /></Field>
          <Field label="Budget (hrs)"><Input type="number" value={budgetHrs} onChange={(e) => setBudgetHrs(Number(e.target.value) || 0)} /></Field>
        </div>
        <Checkbox label="Billable" checked={billable} onChange={setBillable} />
      </div>
    </Modal>
  );
}
