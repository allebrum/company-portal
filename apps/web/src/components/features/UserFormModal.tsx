'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useInviteUser, useUpdateUser, type UserRow } from '@/hooks/useResources';
import { useAuth } from '@/hooks/useAuth';
import type { Role } from '@allebrum/shared';

export function UserFormModal({
  open,
  onClose,
  user,
}: {
  open: boolean;
  onClose: () => void;
  user?: UserRow | null;
}) {
  const isEdit = !!user;
  const toast = useToast();
  const { me } = useAuth();
  const invite = useInviteUser();
  const update = useUpdateUser();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [billable, setBillable] = useState(150);
  const [password, setPassword] = useState('');

  useEffect(() => {
    if (!open) return;
    if (user) {
      setName(user.name);
      setEmail(user.email);
      setRole(user.role);
      setBillable(Number(user.billable));
      setPassword('');
    } else {
      setName('');
      setEmail('');
      setRole('member');
      setBillable(150);
      setPassword('');
    }
  }, [open, user]);

  const onSave = async () => {
    if (!name.trim() || !email.trim()) {
      toast.error('Name and email are required');
      return;
    }
    try {
      if (isEdit && user) {
        await update.mutateAsync({
          id: user.id,
          patch: {
            name: name.trim(),
            email: email.trim(),
            role,
            billable,
            ...(password ? { password } : {}),
          },
        });
        toast.success('User updated');
      } else {
        await invite.mutateAsync({ name: name.trim(), email: email.trim(), role, billable });
        toast.success('Invite sent');
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const busy = invite.isPending || update.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit teammate' : 'Invite teammate'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onSave} disabled={!name.trim() || !email.trim() || busy}>
            {isEdit ? 'Save changes' : 'Send invite'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Role">
            <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="member">Member</option>
              <option value="admin">Admin</option>
              <option value="bookkeeper">Bookkeeper</option>
              {me?.role === 'owner' && <option value="owner">Owner</option>}
            </Select>
          </Field>
          <Field label="Billable rate ($/hr)">
            <Input type="number" value={billable} onChange={(e) => setBillable(Number(e.target.value) || 0)} />
          </Field>
        </div>
        {isEdit && (
          <Field label="Reset password" hint="Leave blank to keep current password">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="New password (min 8 chars)" />
          </Field>
        )}
      </div>
    </Modal>
  );
}
