'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useCreateClient, useUpdateClient, type ClientRow } from '@/hooks/useResources';

type Kind = 'gov' | 'edu' | 'agency' | 'finance' | 'internal';

export function ClientFormModal({
  open,
  onClose,
  client,
}: {
  open: boolean;
  onClose: () => void;
  client?: ClientRow | null;
}) {
  const isEdit = !!client;
  const toast = useToast();
  const create = useCreateClient();
  const update = useUpdateClient();

  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('agency');
  const [color, setColor] = useState('#7e22ce');

  useEffect(() => {
    if (!open) return;
    if (client) {
      setName(client.name);
      setKind(client.kind as Kind);
      setColor(client.color);
    } else {
      setName('');
      setKind('agency');
      setColor('#7e22ce');
    }
  }, [open, client]);

  const onSave = async () => {
    if (!name.trim()) return;
    try {
      if (isEdit && client) {
        await update.mutateAsync({ id: client.id, patch: { name: name.trim(), kind, color } });
        toast.success('Client updated');
      } else {
        await create.mutateAsync({ name: name.trim(), kind, color });
        toast.success('Client created');
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
      title={isEdit ? 'Edit client' : 'Add client'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onSave} disabled={!name.trim() || busy}>
            {isEdit ? 'Save changes' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Kind">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="gov">Government</option>
            <option value="edu">Education</option>
            <option value="agency">Agency</option>
            <option value="finance">Finance</option>
            <option value="internal">Internal</option>
          </Select>
        </Field>
        <Field label="Color"><Input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-20 p-1" /></Field>
      </div>
    </Modal>
  );
}
