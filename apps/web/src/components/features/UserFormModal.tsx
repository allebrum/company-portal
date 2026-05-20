'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { Checkbox } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import {
  useInviteUser,
  useUpdateUser,
  useGroups,
  useSetUserGroups,
  type UserRow,
} from '@/hooks/useResources';
import { api } from '@/lib/api';

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
  const invite = useInviteUser();
  const update = useUpdateUser();
  const setUserGroups = useSetUserGroups();
  const { data: groups = [] } = useGroups();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [billable, setBillable] = useState(150);
  const [password, setPassword] = useState('');
  const [groupIds, setGroupIds] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    if (user) {
      setName(user.name);
      setEmail(user.email);
      setBillable(Number(user.billable));
      setPassword('');
      // load this user's current groups
      void api
        .get<string[]>(`/rbac/users/${user.id}/groups`)
        .then(setGroupIds)
        .catch(() => setGroupIds([]));
    } else {
      setName('');
      setEmail('');
      setBillable(150);
      setPassword('');
      const member = groups.find((g) => g.name === 'Member');
      setGroupIds(member ? [member.id] : []);
    }
  }, [open, user, groups]);

  const toggleGroup = (id: string) =>
    setGroupIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));

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
            billable,
            groupIds,
            ...(password ? { password } : {}),
          },
        });
        toast.success('User updated');
      } else {
        const created = await invite.mutateAsync({
          name: name.trim(),
          email: email.trim(),
          billable,
          groupIds,
          ...(password ? { password } : {}),
        });
        if (groupIds.length > 0) {
          await setUserGroups.mutateAsync({ id: created.id, groupIds });
        }
        toast.success('User added');
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const busy = invite.isPending || update.isPending || setUserGroups.isPending;

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
            {isEdit ? 'Save changes' : 'Invite'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Billable rate ($/hr)">
          <Input type="number" value={billable} onChange={(e) => setBillable(Number(e.target.value) || 0)} />
        </Field>
        <Field label="Groups" hint="Permissions are inherited from group membership">
          <div className="space-y-1.5 rounded-lg border border-gray-200 p-3">
            {groups.length === 0 && <div className="text-sm text-gray-500">No groups yet.</div>}
            {groups.map((g) => (
              <Checkbox
                key={g.id}
                label={g.name}
                checked={groupIds.includes(g.id)}
                onChange={() => toggleGroup(g.id)}
              />
            ))}
          </div>
        </Field>
        <Field
          label={isEdit ? 'Reset password' : 'Password (optional)'}
          hint={
            isEdit
              ? 'Leave blank to keep current password'
              : "Leave blank — they'll sign in with Google (recommended)"
          }
        >
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isEdit ? 'New password (min 8 chars)' : 'Only set for non-Google testers'}
          />
        </Field>
      </div>
    </Modal>
  );
}
