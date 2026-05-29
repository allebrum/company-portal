'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import {
  useCreateClient,
  useUpdateClient,
  useClientContacts,
  useInviteClientContact,
  useResendClientInvite,
  useRemoveClientContact,
  type ClientRow,
} from '@/hooks/useResources';
import { API_URL } from '@/lib/env';
import { Mail, MailCheck, RefreshCw, Send, Trash2 } from 'lucide-react';

type Kind = 'gov' | 'edu' | 'agency' | 'finance' | 'internal';

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{2,39}$/;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

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
  const [portalSlug, setPortalSlug] = useState('');
  const [portalPublished, setPortalPublished] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (client) {
      setName(client.name);
      setKind(client.kind as Kind);
      setColor(client.color);
      setPortalSlug(client.portalSlug ?? '');
      setPortalPublished(!!client.portalPublishedAt);
    } else {
      setName('');
      setKind('agency');
      setColor('#7e22ce');
      setPortalSlug('');
      setPortalPublished(false);
    }
  }, [open, client]);

  const slugValid = portalSlug === '' || SLUG_REGEX.test(portalSlug);
  const slugChanged = (client?.portalSlug ?? '') !== portalSlug;
  const publishChanged = !!client?.portalPublishedAt !== portalPublished;

  const onSave = async () => {
    if (!name.trim()) return;
    if (portalSlug && !slugValid) {
      toast.error('Slug must be 3-40 chars, lowercase letters / digits / hyphens.');
      return;
    }
    try {
      if (isEdit && client) {
        const patch: Parameters<typeof update.mutateAsync>[0]['patch'] = {
          name: name.trim(),
          kind,
          color,
        };
        if (slugChanged) patch.portalSlug = portalSlug.trim() || null;
        if (publishChanged) {
          patch.portalPublishedAt = portalPublished ? new Date().toISOString() : null;
        }
        await update.mutateAsync({ id: client.id, patch });
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
  const portalUrl = portalSlug && slugValid ? `${API_URL.replace(/\/api$/, '')}/portal/${portalSlug}` : '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit client' : 'Add client'}
      size={isEdit ? 'lg' : 'md'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onSave} disabled={!name.trim() || (!!portalSlug && !slugValid) || busy}>
            {isEdit ? 'Save changes' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
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

        {isEdit && (
          <div className="pt-3 border-t border-gray-200 space-y-3">
            <div>
              <div className="text-[11px] uppercase tracking-widest font-bold text-gray-500">
                Public client portal
              </div>
              <p className="text-[12px] text-gray-500 mt-0.5">
                Invited client contacts visit{' '}
                <code className="text-[11px] bg-gray-100 rounded px-1">/portal/{'{slug}'}</code>{' '}
                to see project status and submit tickets.
              </p>
            </div>

            <Field
              label="Slug"
              hint={
                portalSlug && !slugValid
                  ? 'Must be 3-40 chars: lowercase letters, digits, hyphens; start with letter or digit.'
                  : portalUrl ? portalUrl : 'Used in the public URL.'
              }
            >
              <div className="flex items-center gap-2">
                <Input
                  value={portalSlug}
                  onChange={(e) => setPortalSlug(e.target.value.toLowerCase())}
                  placeholder="acme-corp"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPortalSlug(slugify(name))}
                  title="Suggest a slug from the client name"
                >
                  Suggest
                </Button>
              </div>
            </Field>

            <Field label="Published">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={portalPublished}
                  onChange={(e) => setPortalPublished(e.target.checked)}
                  disabled={!portalSlug || !slugValid}
                  className="h-4 w-4 rounded border-gray-300"
                />
                {portalPublished
                  ? 'Live — invited contacts can sign in.'
                  : 'Draft — the public URL returns 404.'}
              </label>
            </Field>

            {client && client.portalSlug && (
              <ContactsManager clientId={client.id} hasSlug />
            )}
            {client && !client.portalSlug && (
              <div className="text-[12px] text-gray-500 italic">
                Set a slug and save to start inviting contacts.
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---- Contacts manager ------------------------------------------------

function ContactsManager({ clientId, hasSlug }: { clientId: string; hasSlug: boolean }) {
  const { data: contacts = [] } = useClientContacts(hasSlug ? clientId : null);
  const invite = useInviteClientContact();
  const resend = useResendClientInvite();
  const remove = useRemoveClientContact();
  const toast = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEmail, setAddEmail] = useState('');
  const [addRole, setAddRole] = useState<'primary' | 'viewer'>('viewer');

  const onInvite = async () => {
    if (!addName.trim() || !addEmail.trim()) return;
    try {
      await invite.mutateAsync({
        clientId,
        input: { name: addName.trim(), email: addEmail.trim(), role: addRole },
      });
      toast.success(`Invite emailed to ${addEmail}`);
      setAddName('');
      setAddEmail('');
      setAddRole('viewer');
      setShowAdd(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Invite failed');
    }
  };

  const onResend = async (contactId: string, email: string) => {
    try {
      await resend.mutateAsync({ clientId, contactId });
      toast.success(`Invite resent to ${email}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Resend failed');
    }
  };

  const onRemove = async (contactId: string, email: string) => {
    if (!confirm(`Remove ${email}? Their sign-in link will stop working immediately.`)) return;
    try {
      await remove.mutateAsync({ clientId, contactId });
      toast.success('Contact removed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Remove failed');
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-[11px] uppercase tracking-widest font-bold text-gray-500">
          Invited contacts · {contacts.length}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? 'Cancel' : '+ Add contact'}
        </Button>
      </div>

      {showAdd && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input
              placeholder="Name"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
            />
            <Input
              type="email"
              placeholder="email@client.com"
              value={addEmail}
              onChange={(e) => setAddEmail(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={addRole} onChange={(e) => setAddRole(e.target.value as 'primary' | 'viewer')}>
              <option value="viewer">Viewer</option>
              <option value="primary">Primary</option>
            </Select>
            <div className="ml-auto">
              <Button variant="primary" size="sm" onClick={onInvite} disabled={invite.isPending || !addName.trim() || !addEmail.trim()}>
                <Send className="w-3.5 h-3.5" /> Send invite
              </Button>
            </div>
          </div>
        </div>
      )}

      {contacts.length === 0 ? (
        <div className="text-[12px] text-gray-400 italic px-1">No contacts invited yet.</div>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
          {contacts.map((c) => {
            const accepted = !!c.acceptedAt;
            return (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                <div className="shrink-0">
                  {accepted ? (
                    <MailCheck className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <Mail className="w-4 h-4 text-amber-600" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-gray-900 truncate">{c.name}</div>
                  <div className="text-[11px] text-gray-500 truncate">
                    {c.email} · {accepted ? 'Accepted' : 'Invited'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onResend(c.id, c.email)}
                  className="text-gray-400 hover:text-brand-700"
                  title="Resend invite"
                  disabled={resend.isPending}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(c.id, c.email)}
                  className="text-gray-300 hover:text-red-600"
                  title="Remove contact"
                  disabled={remove.isPending}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
