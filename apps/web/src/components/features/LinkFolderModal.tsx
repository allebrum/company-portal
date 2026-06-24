'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useLinkDriveFolder, useClients } from '@/hooks/useResources';

export function LinkFolderModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const toast = useToast();
  const { data: clients = [] } = useClients();
  const link = useLinkDriveFolder();

  const [drivePath, setDrivePath] = useState('');
  const [clientId, setClientId] = useState('');
  const [itemCount, setItemCount] = useState(0);

  useEffect(() => {
    if (!open) return;
    setDrivePath('');
    setClientId('');
    setItemCount(0);
  }, [open]);

  const onSave = async () => {
    if (!drivePath.trim() || !clientId) {
      toast.error('Path and client are required');
      return;
    }
    try {
      await link.mutateAsync({ drivePath: drivePath.trim(), clientId, itemCount });
      toast.success('Folder linked');
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Link failed');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Link Drive folder"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onSave} disabled={!drivePath.trim() || !clientId || link.isPending}>
            Link folder
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Drive path" hint="e.g. Modern Zen LLC / Clients / Foothill CU">
          <Input value={drivePath} onChange={(e) => setDrivePath(e.target.value)} />
        </Field>
        <Field label="Client">
          <Select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— Pick a client —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Item count (optional)">
          <Input type="number" min={0} value={itemCount} onChange={(e) => setItemCount(Number(e.target.value) || 0)} />
        </Field>
      </div>
    </Modal>
  );
}
