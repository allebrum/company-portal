'use client';

import { useMemo, useState } from 'react';
import { Globe, KeyRound, Pencil, Plus, Save, ShieldCheck, Trash2, Users } from 'lucide-react';
import type { WebsiteBillingCycle, WebsiteRow, WebsiteStatus } from '@allebrum/shared';
import { Field, Input, Select, Textarea, Checkbox } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { relativeFromIso } from '@/lib/formatters';
import { useUsers } from '@/hooks/useResources';
import { useAuth } from '@/hooks/useAuth';
import { Empty } from '@/components/ui/Card';
import {
  useCreateWebsite,
  useDeleteWebsite,
  useUpdateWebsite,
  useWebsiteCredentials,
  useWebsites,
} from '@/hooks/useWebsites';

const BILLING_CYCLES: WebsiteBillingCycle[] = ['monthly', 'annual', 'quarterly', 'one-time', 'custom'];
const STATUSES: WebsiteStatus[] = ['active', 'trial', 'paused', 'canceled'];

type FormState = {
  id: string | null;
  name: string;
  siteUrl: string;
  category: string;
  status: WebsiteStatus;
  billingCycle: WebsiteBillingCycle;
  billingAmount: string;
  billingCurrency: string;
  renewalDate: string;
  notes: string;
  assignedUserIds: string[];
  credUsername: string;
  credPassword: string;
  clearCredentials: boolean;
};

function blankForm(): FormState {
  return {
    id: null,
    name: '',
    siteUrl: '',
    category: '',
    status: 'active',
    billingCycle: 'monthly',
    billingAmount: '',
    billingCurrency: 'USD',
    renewalDate: '',
    notes: '',
    assignedUserIds: [],
    credUsername: '',
    credPassword: '',
    clearCredentials: false,
  };
}

function centsFromAmount(amount: string): number | null {
  const t = amount.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function amountFromCents(cents: number | null): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(2);
}

function websiteToForm(w: WebsiteRow): FormState {
  return {
    id: w.id,
    name: w.name,
    siteUrl: w.siteUrl,
    category: w.category,
    status: w.status,
    billingCycle: w.billingCycle,
    billingAmount: amountFromCents(w.billingAmountCents),
    billingCurrency: w.billingCurrency,
    renewalDate: w.renewalDate ?? '',
    notes: w.notes,
    assignedUserIds: [...w.assignedUserIds],
    credUsername: '',
    credPassword: '',
    clearCredentials: false,
  };
}

export default function WebsitesToolPage() {
  const { can } = useAuth();
  const canView = can('websites.view');
  const canCreate = can('websites.create');
  const canDelete = can('websites.delete');

  const websites = useWebsites(canView);
  const users = useUsers();
  const create = useCreateWebsite();
  const update = useUpdateWebsite();
  const remove = useDeleteWebsite();
  const toast = useToast();
  const confirmDialog = useConfirm();

  const [form, setForm] = useState<FormState>(blankForm());
  const [formOpen, setFormOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [credentialTargetId, setCredentialTargetId] = useState<string | null>(null);

  const usersById = useMemo(
    () => new Map((users.data ?? []).map((u) => [u.id, u])),
    [users.data],
  );

  const activeCredentials = useWebsiteCredentials(credentialTargetId);

  const filteredWebsites = useMemo(() => {
    const rows = websites.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((w) => {
      const assignees = w.assignedUserIds
        .map((id) => usersById.get(id)?.name ?? '')
        .join(' ')
        .toLowerCase();
      return [
        w.name,
        w.siteUrl,
        w.category,
        w.status,
        w.notes,
        assignees,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [search, usersById, websites.data]);

  const save = async () => {
    const amountCents = centsFromAmount(form.billingAmount);
    if (form.billingAmount.trim() && amountCents == null) {
      toast.error('Billing amount must be a valid non-negative number');
      return;
    }

    const credentials = form.clearCredentials
      ? { username: null, password: null }
      : form.credUsername.trim() || form.credPassword.trim()
        ? {
            username: form.credUsername.trim() || null,
            password: form.credPassword.trim() || null,
          }
        : undefined;

    const payload = {
      name: form.name.trim(),
      siteUrl: form.siteUrl.trim(),
      category: form.category.trim(),
      status: form.status,
      billingCycle: form.billingCycle,
      billingAmountCents: amountCents,
      billingCurrency: form.billingCurrency.trim().toUpperCase() || 'USD',
      renewalDate: form.renewalDate || null,
      notes: form.notes,
      assignedUserIds: form.assignedUserIds,
      credentials,
    };

    if (!payload.name || !payload.siteUrl) {
      toast.error('Name and URL are required');
      return;
    }

    try {
      if (form.id) {
        await update.mutateAsync({ id: form.id, patch: payload });
        toast.success('Website updated');
        setFormOpen(false);
      } else {
        await create.mutateAsync(payload);
        toast.success('Website added');
        setFormOpen(false);
      }
      setForm(blankForm());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const onDelete = async (website: WebsiteRow) => {
    const ok = await confirmDialog({
      title: `Archive ${website.name}?`,
      body: 'This keeps history but removes it from the main list.',
      confirmLabel: 'Archive',
      danger: true,
    });
    if (!ok) return;
    try {
      await remove.mutateAsync(website.id);
      if (form.id === website.id) setForm(blankForm());
      toast.success('Archived');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Archive failed');
    }
  };

  const revealCredentials = (websiteId: string) => {
    setCredentialTargetId(websiteId);
  };

  const busy = create.isPending || update.isPending || remove.isPending;

  if (!canView) {
    return <Empty title="No access" description="You don't have permission to view the Website Memory Bank." />;
  }

  return (
    <div className="space-y-7 max-w-6xl">
      <div>
        <div className="eyebrow">Tools</div>
        <h1 className="text-2xl font-bold text-gray-900">Website Memory Bank</h1>
        <p className="mt-1 text-sm text-gray-500">
          Track every SaaS and web tool your company uses, who owns it, what it costs, and optional encrypted credentials.
        </p>
      </div>

      <div>
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="text-[11px] uppercase tracking-widest font-bold text-gray-500">
            Website directory · {filteredWebsites.length}
            {search.trim() ? ` of ${websites.data?.length ?? 0}` : ''}
          </div>
          <Button
            size="sm"
            variant="primary"
            disabled={!canCreate}
            onClick={() => {
              setForm(blankForm());
              setFormOpen(true);
            }}
          >
            <Plus className="w-4 h-4" />
            Add Website
          </Button>
        </div>

        <div className="mb-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, URL, category, status, notes, or assignee"
          />
        </div>

        {!websites.data ? (
          <div className="rounded-xl bg-gray-100 animate-pulse h-28" />
        ) : filteredWebsites.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-8 text-center">
            <div className="font-semibold text-gray-700">
              {search.trim() ? 'No matching websites' : 'No websites yet'}
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {search.trim()
                ? 'Try a different search term.'
                : 'Click Add Website to start your company memory bank.'}
            </p>
          </div>
        ) : (
          <ul className="rounded-2xl border border-gray-200 bg-white divide-y divide-gray-100">
            {filteredWebsites.map((w) => (
              <li key={w.id} className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <span className="w-9 h-9 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
                    <Globe className="w-4 h-4" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-semibold text-gray-900 truncate">{w.name}</div>
                      <span className="text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 bg-gray-100 text-gray-600">
                        {w.status}
                      </span>
                      {w.category && (
                        <span className="text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 bg-indigo-100 text-indigo-700">
                          {w.category}
                        </span>
                      )}
                    </div>
                    <a href={w.siteUrl} target="_blank" rel="noreferrer" className="text-sm text-brand-700 hover:underline break-all">
                      {w.siteUrl}
                    </a>
                    <div className="mt-1 text-xs text-gray-500">
                      {w.billingAmountCents != null
                        ? `${w.billingCurrency} ${(w.billingAmountCents / 100).toFixed(2)} / ${w.billingCycle}`
                        : `Billing: ${w.billingCycle}`}
                      {w.renewalDate ? ` · renews ${w.renewalDate}` : ''}
                    </div>
                    <div className="mt-1 text-xs text-gray-500 flex items-center gap-1">
                      <Users className="w-3 h-3" />
                      {w.assignedUserIds.length
                        ? w.assignedUserIds
                            .map((id) => usersById.get(id)?.name ?? 'Unknown user')
                            .join(', ')
                        : 'No assignees'}
                    </div>
                    {w.notes && <p className="mt-2 text-sm text-gray-600 whitespace-pre-wrap">{w.notes}</p>}
                    <div className="mt-2 text-xs text-gray-500">
                      Credentials: {w.hasCredentialUsername || w.hasCredentialPassword ? 'stored' : 'none'}
                      {w.credentialsUpdatedAt ? ` · updated ${relativeFromIso(w.credentialsUpdatedAt)}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!canCreate}
                      onClick={() => {
                        setForm(websiteToForm(w));
                        setFormOpen(true);
                      }}
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => revealCredentials(w.id)}
                      title="Reveal credentials"
                      disabled={!w.hasCredentialUsername && !w.hasCredentialPassword}
                    >
                      <KeyRound className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!canDelete}
                      onClick={() => onDelete(w)}
                      title="Archive"
                    >
                      <Trash2 className="w-4 h-4 text-red-600" />
                    </Button>
                  </div>
                </div>

                {credentialTargetId === w.id && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm">
                    {activeCredentials.isFetching ? (
                      <div className="text-gray-500">Loading credentials...</div>
                    ) : activeCredentials.isError ? (
                      <div className="text-red-600">
                        {activeCredentials.error instanceof Error
                          ? activeCredentials.error.message
                          : 'Unable to reveal credentials'}
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <div className="text-xs uppercase tracking-wider text-gray-500">Username</div>
                          <div className="font-mono text-gray-900 break-all">
                            {activeCredentials.data?.username || 'None'}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-wider text-gray-500">Password</div>
                          <div className="font-mono text-gray-900 break-all">
                            {activeCredentials.data?.password || 'None'}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <Modal
        open={canCreate && formOpen}
        onClose={() => {
          setFormOpen(false);
          setForm(blankForm());
        }}
        title={form.id ? 'Edit website' : 'Add website'}
        size="3xl"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Website name" required>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Google Workspace"
              />
            </Field>
            <Field label="Website URL" required>
              <Input
                type="url"
                value={form.siteUrl}
                onChange={(e) => setForm((f) => ({ ...f, siteUrl: e.target.value }))}
                placeholder="https://workspace.google.com"
              />
            </Field>
            <Field label="Category">
              <Input
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                placeholder="Email / Collaboration"
              />
            </Field>
            <Field label="Status">
              <Select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as WebsiteStatus }))}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field label="Billing cycle">
              <Select
                value={form.billingCycle}
                onChange={(e) => setForm((f) => ({ ...f, billingCycle: e.target.value as WebsiteBillingCycle }))}
              >
                {BILLING_CYCLES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Amount">
              <Input
                inputMode="decimal"
                value={form.billingAmount}
                onChange={(e) => setForm((f) => ({ ...f, billingAmount: e.target.value }))}
                placeholder="29.99"
              />
            </Field>
            <Field label="Currency">
              <Input
                maxLength={3}
                value={form.billingCurrency}
                onChange={(e) => setForm((f) => ({ ...f, billingCurrency: e.target.value.toUpperCase() }))}
                placeholder="USD"
              />
            </Field>
            <Field label="Renewal date">
              <Input
                type="date"
                value={form.renewalDate}
                onChange={(e) => setForm((f) => ({ ...f, renewalDate: e.target.value }))}
              />
            </Field>
          </div>

          <Field label="Assigned team members" hint="Use this to show who manages this service internally.">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 rounded-lg border border-gray-200 p-3">
              {(users.data ?? []).map((u) => {
                const checked = form.assignedUserIds.includes(u.id);
                return (
                  <Checkbox
                    key={u.id}
                    label={`${u.name} (${u.email})`}
                    checked={checked}
                    onChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        assignedUserIds: v
                          ? [...f.assignedUserIds, u.id]
                          : f.assignedUserIds.filter((id) => id !== u.id),
                      }))
                    }
                  />
                );
              })}
              {users.data && users.data.length === 0 && (
                <div className="text-sm text-gray-500">No users found in this workspace.</div>
              )}
            </div>
          </Field>

          <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-3">
            <div className="flex items-center gap-2 text-emerald-800 font-semibold text-sm">
              <ShieldCheck className="w-4 h-4" />
              Optional encrypted credentials
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Username / login email">
                <Input
                  value={form.credUsername}
                  onChange={(e) => setForm((f) => ({ ...f, credUsername: e.target.value }))}
                  placeholder="owner@company.com"
                />
              </Field>
              <Field label="Password">
                <Input
                  type="password"
                  value={form.credPassword}
                  onChange={(e) => setForm((f) => ({ ...f, credPassword: e.target.value }))}
                  placeholder="••••••••••"
                />
              </Field>
            </div>
            <Checkbox
              label="Clear stored credentials on save"
              checked={form.clearCredentials}
              onChange={(v) => setForm((f) => ({ ...f, clearCredentials: v }))}
            />
          </div>

          <Field label="Notes">
            <Textarea
              rows={4}
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Contract details, support SLA, account owner, MFA policy, etc."
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setForm(blankForm())}
              disabled={busy}
            >
              Reset
            </Button>
            <Button onClick={save} disabled={busy || !form.name.trim() || !form.siteUrl.trim()}>
              {form.id ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              {form.id ? 'Save changes' : 'Add website'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
