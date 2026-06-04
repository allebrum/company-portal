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
  defaultClientId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  project?: ProjectRow | null;
  /** F25: pre-fill the Client picker when opening from a Client Space. */
  defaultClientId?: string | null;
  /** F25: called with the newly-created row so callers can deep-link in. */
  onCreated?: (row: ProjectRow) => void;
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
  const [opportunityStatus, setOpportunityStatus] = useState<'pipeline' | 'won' | 'lost' | 'on-hold'>('pipeline');
  const [opportunityValueText, setOpportunityValueText] = useState('');
  const [billable, setBillable] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (project) {
      setClientId(project.clientId);
      setName(project.name);
      setCode(project.code);
      setBudgetHrs(project.budgetHrs);
      setOpportunityStatus(project.opportunityStatus ?? 'pipeline');
      setOpportunityValueText(project.opportunityValue == null ? '' : String(project.opportunityValue));
      setBillable(project.billable);
    } else {
      // F25: default-client pre-fill on create when caller supplies one
      // (e.g. opening "Add project" from inside a Client Space).
      setClientId(defaultClientId ?? '');
      setName('');
      setCode('');
      setBudgetHrs(120);
      setOpportunityStatus('pipeline');
      setOpportunityValueText('');
      setBillable(true);
    }
  }, [open, project, defaultClientId]);

  const onSave = async () => {
    if (!name.trim() || !clientId) {
      toast.error('Client and name are required');
      return;
    }
    const trimmedValue = opportunityValueText.trim();
    let opportunityValue: number | null = null;
    if (trimmedValue !== '') {
      const parsed = Number(trimmedValue);
      if (!Number.isInteger(parsed) || parsed < 0) {
        toast.error('Opportunity value must be a non-negative whole number');
        return;
      }
      opportunityValue = parsed;
    }
    try {
      if (isEdit && project) {
        await update.mutateAsync({
          id: project.id,
          patch: { clientId, name: name.trim(), code, budgetHrs, billable, opportunityStatus, opportunityValue },
        });
        toast.success('Project updated');
      } else {
        const row = await create.mutateAsync({
          clientId,
          name: name.trim(),
          code,
          budgetHrs,
          billable,
          opportunityStatus,
          opportunityValue,
          color: '#9333ea',
        });
        toast.success('Project created');
        onCreated?.(row);
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Project status">
            <Select value={opportunityStatus} onChange={(e) => setOpportunityStatus(e.target.value as 'pipeline' | 'won' | 'lost' | 'on-hold')}>
              <option value="pipeline">Pipeline</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="on-hold">On hold</option>
            </Select>
          </Field>
          <Field label="Opportunity value">
            <Input
              type="number"
              min={0}
              step={1}
              value={opportunityValueText}
              onChange={(e) => setOpportunityValueText(e.target.value)}
              placeholder="e.g. 25000"
            />
          </Field>
        </div>
        <Checkbox label="Billable" checked={billable} onChange={setBillable} />
      </div>
    </Modal>
  );
}
