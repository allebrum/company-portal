'use client';

import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
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
  const [groupIds, setGroupIds] = useState<string[]>([]);
  // Reset-password-by-admin is a separate "type a new password" flow on
  // edit. New invites never carry a password — the invitee sets their own
  // via the accept-invite email link.
  const [password, setPassword] = useState('');
  // Defaults to true so the typical invite path sends an email. Toggle off
  // for Google-only teammates who'll sign in via OAuth and shouldn't get a
  // "set a password" email at all.
  const [sendInvite, setSendInvite] = useState(true);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (user) {
      setName(user.name);
      setEmail(user.email);
      setBillable(Number(user.billable));
      setPassword('');
      setSendInvite(true);
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
      setSendInvite(true);
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
        await invite.mutateAsync({
          name: name.trim(),
          email: email.trim(),
          billable,
          groupIds,
          sendInvite,
        });
        toast.success(
          sendInvite
            ? `Invite emailed to ${email.trim()}`
            : `${name.trim()} added — they can sign in with Google`,
        );
      }
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const onResendInvite = async () => {
    if (!user) return;
    setResending(true);
    try {
      await api.post(`/users/${user.id}/resend-invite`);
      toast.success(`Invite re-sent to ${user.email}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Resend failed');
    } finally {
      setResending(false);
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

        {!isEdit && (
          <Field label="Invite" hint="Sends a transactional email with a link to set their password.">
            <Checkbox
              label="Email an invite link"
              checked={sendInvite}
              onChange={(v) => setSendInvite(v)}
            />
          </Field>
        )}

        {isEdit && user?.status === 'invited' && (
          <Field
            label="Pending invite"
            hint="This teammate hasn't activated their account yet. Re-send the invite email if their original link expired or was lost."
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onResendInvite}
              disabled={resending}
            >
              <Mail className="w-4 h-4" /> {resending ? 'Sending…' : 'Resend invite email'}
            </Button>
          </Field>
        )}

        {isEdit && (
          <Field
            label="Reset password (admin override)"
            hint="Leave blank to keep current password. Sending the user the forgot-password flow is usually preferable."
          >
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (min 8 chars)"
            />
          </Field>
        )}
      </div>
    </Modal>
  );
}
