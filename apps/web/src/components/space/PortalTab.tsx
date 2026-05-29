'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Mail, MailCheck, RefreshCw, Send, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import {
  useClientContacts,
  useInviteClientContact,
  useResendClientInvite,
  useRemoveClientContact,
  useUpdateClient,
  type ClientRow,
} from '@/hooks/useResources';
import { API_URL } from '@/lib/env';

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

function portalOriginFor(slug: string): string {
  // API_URL is like "https://rc.allebrum.com/api"; the portal page lives
  // at the bare origin (same domain as the staff app, since both ship in
  // the same static export).
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/portal/${slug}`;
  }
  return `${API_URL.replace(/\/api$/, '')}/portal/${slug}`;
}

/**
 * F23 Phase 2C — Portal settings module inside the Client Space.
 *
 * Surfaces the same slug + publish + contacts controls as the
 * ClientFormModal Portal section, plus a live iframe preview of the
 * public portal so staff can verify what their client sees without
 * having to log out and open the URL fresh.
 *
 * Lives at the client scope only — projects don't have their own portal
 * surface in v1.
 */
export function PortalTab({ client }: { client: ClientRow }) {
  const toast = useToast();
  const update = useUpdateClient();
  const [slug, setSlug] = useState(client.portalSlug ?? '');
  const [published, setPublished] = useState(!!client.portalPublishedAt);
  const [previewKey, setPreviewKey] = useState(0); // bumped to force iframe reload

  // Sync local edits with whatever the server now holds whenever the
  // client row refreshes (e.g. another staff member edited it).
  useEffect(() => {
    setSlug(client.portalSlug ?? '');
    setPublished(!!client.portalPublishedAt);
  }, [client.portalSlug, client.portalPublishedAt]);

  const slugValid = slug === '' || SLUG_REGEX.test(slug);
  const slugChanged = (client.portalSlug ?? '') !== slug;
  const publishChanged = !!client.portalPublishedAt !== published;
  const hasPending = slugChanged || publishChanged;

  const onSave = async () => {
    if (slug && !slugValid) {
      toast.error('Slug must be 3-40 chars, lowercase letters / digits / hyphens.');
      return;
    }
    try {
      const patch: Parameters<typeof update.mutateAsync>[0]['patch'] = {};
      if (slugChanged) patch.portalSlug = slug.trim() || null;
      if (publishChanged) {
        patch.portalPublishedAt = published ? new Date().toISOString() : null;
      }
      await update.mutateAsync({ id: client.id, patch });
      toast.success('Portal settings saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const liveUrl = client.portalSlug && client.portalPublishedAt ? portalOriginFor(client.portalSlug) : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Public client portal</h2>
        <p className="text-sm text-gray-500 mt-1">
          Configure the URL slug, publish state, and invited contacts for{' '}
          <span className="font-semibold text-gray-700">{client.name}</span>&apos;s portal.
          Preview the live page below the settings.
        </p>
      </div>

      {/* Settings card */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
        <Field
          label="Slug"
          hint={
            slug && !slugValid
              ? 'Must be 3-40 chars: lowercase letters, digits, hyphens; start with letter or digit.'
              : slug && slugValid
                ? portalOriginFor(slug)
                : 'Used in the public URL.'
          }
        >
          <div className="flex items-center gap-2">
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
              placeholder="acme-corp"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSlug(slugify(client.name))}
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
              checked={published}
              onChange={(e) => setPublished(e.target.checked)}
              disabled={!slug || !slugValid}
              className="h-4 w-4 rounded border-gray-300"
            />
            {published
              ? 'Live — invited contacts can sign in.'
              : 'Draft — the public URL returns 404.'}
          </label>
        </Field>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
          {liveUrl && (
            <a
              href={liveUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-brand-700 hover:underline mr-auto"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open in new tab
            </a>
          )}
          {hasPending && (
            <span className="text-[11px] uppercase tracking-widest font-bold text-amber-600">
              Unsaved
            </span>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={onSave}
            disabled={update.isPending || !hasPending || (!!slug && !slugValid)}
          >
            Save settings
          </Button>
        </div>
      </div>

      {/* Contacts */}
      {client.portalSlug ? (
        <ContactsCard clientId={client.id} />
      ) : (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4 text-sm text-gray-500">
          Set a slug and save above to start inviting client contacts.
        </div>
      )}

      {/* Preview */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[11px] uppercase tracking-widest font-bold text-gray-500">
            Live preview
          </div>
          {liveUrl && (
            <button
              type="button"
              onClick={() => setPreviewKey((k) => k + 1)}
              className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-brand-700"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reload
            </button>
          )}
        </div>
        {liveUrl ? (
          <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden">
            <iframe
              key={previewKey}
              src={liveUrl}
              title={`${client.name} portal preview`}
              className="w-full h-[640px] bg-gray-50"
            />
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
            <div className="font-semibold text-gray-700">Preview unavailable</div>
            <p className="mt-1 text-sm text-gray-500">
              {client.portalSlug
                ? 'Publish the portal to render the preview here.'
                : 'Set a slug, publish, and save to load the preview.'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Contacts card ---------------------------------------------------

function ContactsCard({ clientId }: { clientId: string }) {
  const { data: contacts = [] } = useClientContacts(clientId);
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

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-bold text-gray-900">Invited contacts</div>
          <div className="text-[11px] text-gray-500">
            {contacts.length} {contacts.length === 1 ? 'contact' : 'contacts'}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setShowAdd((v) => !v)}>
          {showAdd ? 'Cancel' : '+ Add contact'}
        </Button>
      </div>

      {showAdd && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Name" value={addName} onChange={(e) => setAddName(e.target.value)} />
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
              <Button
                variant="primary"
                size="sm"
                onClick={onInvite}
                disabled={invite.isPending || !addName.trim() || !addEmail.trim()}
              >
                <Send className="w-3.5 h-3.5" />
                Send invite
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
                  onClick={async () => {
                    try {
                      await resend.mutateAsync({ clientId, contactId: c.id });
                      toast.success(`Invite resent to ${c.email}`);
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Resend failed');
                    }
                  }}
                  className="text-gray-400 hover:text-brand-700"
                  title="Resend invite"
                  disabled={resend.isPending}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    if (!confirm(`Remove ${c.email}? Their sign-in link will stop working immediately.`)) return;
                    try {
                      await remove.mutateAsync({ clientId, contactId: c.id });
                      toast.success('Contact removed');
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Remove failed');
                    }
                  }}
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
