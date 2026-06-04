'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, Input, Checkbox } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import { useProjects, useUpdateClient, type ClientRow } from '@/hooks/useResources';
import type { StructuredAddress, StructuredContact } from '@allebrum/shared';

const STATUS_ORDER = ['pipeline', 'won', 'lost', 'on-hold'] as const;
const STATUS_LABEL: Record<(typeof STATUS_ORDER)[number], string> = {
  pipeline: 'Pipeline',
  won: 'Won',
  lost: 'Lost',
  'on-hold': 'On hold',
};

function blankContact(): StructuredContact {
  return {
    id: crypto.randomUUID(),
    name: '',
    email: '',
    phone: '',
    role: '',
    canMarket: false,
    isPoc: false,
  };
}

function blankAddress(): StructuredAddress {
  return {
    id: crypto.randomUUID(),
    type: '',
    label: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  };
}

function cleanText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function ClientOverviewTab({ client }: { client: ClientRow }) {
  const { data: projects = [] } = useProjects();
  const updateClient = useUpdateClient();
  const toast = useToast();
  const { can } = useAuth();
  const canEdit = can('clients.manage');

  const [contacts, setContacts] = useState<StructuredContact[]>([]);
  const [addresses, setAddresses] = useState<StructuredAddress[]>([]);

  useEffect(() => {
    setContacts(client.clientOverview?.contacts ?? []);
    setAddresses(client.clientOverview?.addresses ?? []);
  }, [client.id, client.clientOverview]);

  const clientProjects = useMemo(
    () => projects.filter((p) => p.clientId === client.id),
    [projects, client.id],
  );
  const statusCounts = useMemo(() => {
    const out = { pipeline: 0, won: 0, lost: 0, 'on-hold': 0 };
    for (const p of clientProjects) out[p.opportunityStatus] += 1;
    return out;
  }, [clientProjects]);

  const totalOpp = clientProjects.reduce((s, p) => s + (p.opportunityValue ?? 0), 0);
  const totalTimeMin = clientProjects.reduce((s, p) => s + p.timeSpentMin, 0);
  const topByEffort = [...clientProjects]
    .sort((a, b) => b.timeSpentMin - a.timeSpentMin)
    .slice(0, 6);

  const onSave = async () => {
    const normalizedContacts = contacts
      .map((c) => ({
        ...c,
        name: c.name.trim(),
        email: cleanText(c.email ?? ''),
        phone: cleanText(c.phone ?? ''),
        role: cleanText(c.role ?? ''),
      }))
      .filter((c) => c.name.length > 0);

    const normalizedAddresses = addresses
      .map((a) => ({
        ...a,
        type: a.type.trim(),
        label: cleanText(a.label ?? ''),
        line1: cleanText(a.line1 ?? ''),
        line2: cleanText(a.line2 ?? ''),
        city: cleanText(a.city ?? ''),
        state: cleanText(a.state ?? ''),
        postalCode: cleanText(a.postalCode ?? ''),
        country: cleanText(a.country ?? ''),
      }))
      .filter((a) => a.type.length > 0 || a.line1 || a.city || a.country);

    try {
      await updateClient.mutateAsync({
        id: client.id,
        patch: {
          clientOverview: {
            contacts: normalizedContacts,
            addresses: normalizedAddresses,
          },
        },
      });
      toast.success('Client overview saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save client overview');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <MetricCard label="Projects" value={String(clientProjects.length)} />
        <MetricCard label="Pipeline Value" value={new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalOpp)} />
        <MetricCard label="Tracked Effort" value={`${Math.round(totalTimeMin / 60)}h`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-sm font-semibold text-gray-900 mb-3">Opportunity mix</div>
          <div className="space-y-2">
            {STATUS_ORDER.map((k) => {
              const count = statusCounts[k];
              const total = Math.max(1, clientProjects.length);
              const width = Math.round((count / total) * 100);
              return (
                <div key={k}>
                  <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                    <span>{STATUS_LABEL[k]}</span>
                    <span>{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full bg-brand-500" style={{ width: `${width}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="text-sm font-semibold text-gray-900 mb-3">Top projects by effort</div>
          {topByEffort.length === 0 ? (
            <div className="text-sm text-gray-500">No tracked time yet.</div>
          ) : (
            <div className="space-y-2">
              {topByEffort.map((p) => {
                const top = Math.max(1, topByEffort[0]?.timeSpentMin ?? 1);
                const width = Math.round((p.timeSpentMin / top) * 100);
                return (
                  <div key={p.id}>
                    <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                      <span className="truncate max-w-[70%]">{p.name}</span>
                      <span>{Math.round(p.timeSpentMin / 60)}h</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${width}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900">Contacts</div>
          {canEdit && (
            <Button variant="ghost" size="sm" onClick={() => setContacts((prev) => [...prev, blankContact()])}>
              <Plus className="w-3.5 h-3.5" /> Add contact
            </Button>
          )}
        </div>

        {contacts.length === 0 ? (
          <div className="text-sm text-gray-500">No contacts yet.</div>
        ) : (
          <div className="space-y-4">
            {contacts.map((contact) => (
              <div key={contact.id} className="rounded-lg border border-gray-200 p-3 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Name">
                    <Input disabled={!canEdit} value={contact.name} onChange={(e) => setContacts((prev) => prev.map((c) => (c.id === contact.id ? { ...c, name: e.target.value } : c)))} />
                  </Field>
                  <Field label="Role">
                    <Input disabled={!canEdit} value={contact.role ?? ''} onChange={(e) => setContacts((prev) => prev.map((c) => (c.id === contact.id ? { ...c, role: e.target.value } : c)))} />
                  </Field>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Email">
                    <Input disabled={!canEdit} type="email" value={contact.email ?? ''} onChange={(e) => setContacts((prev) => prev.map((c) => (c.id === contact.id ? { ...c, email: e.target.value } : c)))} />
                  </Field>
                  <Field label="Phone">
                    <Input disabled={!canEdit} value={contact.phone ?? ''} onChange={(e) => setContacts((prev) => prev.map((c) => (c.id === contact.id ? { ...c, phone: e.target.value } : c)))} />
                  </Field>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-4">
                    <Checkbox label="Can market" checked={!!contact.canMarket} onChange={(v) => setContacts((prev) => prev.map((c) => (c.id === contact.id ? { ...c, canMarket: v } : c)))} disabled={!canEdit} />
                    <Checkbox label="POC" checked={!!contact.isPoc} onChange={(v) => setContacts((prev) => prev.map((c) => (c.id === contact.id ? { ...c, isPoc: v } : c)))} disabled={!canEdit} />
                  </div>
                  {canEdit && (
                    <Button variant="ghost" size="sm" onClick={() => setContacts((prev) => prev.filter((c) => c.id !== contact.id))}>
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900">Addresses</div>
          {canEdit && (
            <Button variant="ghost" size="sm" onClick={() => setAddresses((prev) => [...prev, blankAddress()])}>
              <Plus className="w-3.5 h-3.5" /> Add address
            </Button>
          )}
        </div>

        {addresses.length === 0 ? (
          <div className="text-sm text-gray-500">No addresses yet.</div>
        ) : (
          <div className="space-y-4">
            {addresses.map((addr) => (
              <div key={addr.id} className="rounded-lg border border-gray-200 p-3 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Type">
                    <Input disabled={!canEdit} value={addr.type} onChange={(e) => setAddresses((prev) => prev.map((a) => (a.id === addr.id ? { ...a, type: e.target.value } : a)))} placeholder="e.g. billing, office, warehouse" />
                  </Field>
                  <Field label="Label">
                    <Input disabled={!canEdit} value={addr.label ?? ''} onChange={(e) => setAddresses((prev) => prev.map((a) => (a.id === addr.id ? { ...a, label: e.target.value } : a)))} placeholder="Optional nickname" />
                  </Field>
                </div>
                <Field label="Line 1">
                  <Input disabled={!canEdit} value={addr.line1 ?? ''} onChange={(e) => setAddresses((prev) => prev.map((a) => (a.id === addr.id ? { ...a, line1: e.target.value } : a)))} />
                </Field>
                <Field label="Line 2">
                  <Input disabled={!canEdit} value={addr.line2 ?? ''} onChange={(e) => setAddresses((prev) => prev.map((a) => (a.id === addr.id ? { ...a, line2: e.target.value } : a)))} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="City">
                    <Input disabled={!canEdit} value={addr.city ?? ''} onChange={(e) => setAddresses((prev) => prev.map((a) => (a.id === addr.id ? { ...a, city: e.target.value } : a)))} />
                  </Field>
                  <Field label="State / Region">
                    <Input disabled={!canEdit} value={addr.state ?? ''} onChange={(e) => setAddresses((prev) => prev.map((a) => (a.id === addr.id ? { ...a, state: e.target.value } : a)))} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Postal code">
                    <Input disabled={!canEdit} value={addr.postalCode ?? ''} onChange={(e) => setAddresses((prev) => prev.map((a) => (a.id === addr.id ? { ...a, postalCode: e.target.value } : a)))} />
                  </Field>
                  <Field label="Country">
                    <Input disabled={!canEdit} value={addr.country ?? ''} onChange={(e) => setAddresses((prev) => prev.map((a) => (a.id === addr.id ? { ...a, country: e.target.value } : a)))} />
                  </Field>
                </div>
                {canEdit && (
                  <div className="flex justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setAddresses((prev) => prev.filter((a) => a.id !== addr.id))}>
                      <Trash2 className="w-3.5 h-3.5" /> Remove
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {canEdit && (
        <div className="flex justify-end">
          <Button variant="primary" onClick={onSave} disabled={updateClient.isPending}>
            Save overview
          </Button>
        </div>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}
