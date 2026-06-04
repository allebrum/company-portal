'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Checkbox } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';
import { useUpdateProject, type ProjectRow } from '@/hooks/useResources';
import type { ProjectAddress, ProjectContact } from '@allebrum/shared';

function blankAddress(): ProjectAddress {
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

function blankContact(): ProjectContact {
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

function cleanText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

export function ProjectOverviewTab({ project }: { project: ProjectRow }) {
  const updateProject = useUpdateProject();
  const toast = useToast();
  const { can } = useAuth();
  const canEdit = can('projects.manage');

  const [opportunityStatus, setOpportunityStatus] = useState<ProjectRow['opportunityStatus']>('pipeline');
  const [opportunityValueText, setOpportunityValueText] = useState('');
  const [contacts, setContacts] = useState<ProjectContact[]>([]);
  const [addresses, setAddresses] = useState<ProjectAddress[]>([]);

  useEffect(() => {
    setOpportunityStatus(project.opportunityStatus ?? 'pipeline');
    setOpportunityValueText(project.opportunityValue == null ? '' : String(project.opportunityValue));
    setContacts(project.projectOverview?.contacts ?? []);
    setAddresses(project.projectOverview?.addresses ?? []);
  }, [project.id, project.opportunityStatus, project.opportunityValue, project.projectOverview]);

  const onContactChange = (id: string, patch: Partial<ProjectContact>) => {
    setContacts((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const onSave = async () => {
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
      await updateProject.mutateAsync({
        id: project.id,
        patch: {
          opportunityStatus,
          opportunityValue,
          projectOverview: {
            contacts: normalizedContacts,
            addresses: normalizedAddresses,
          },
        },
      });
      toast.success('Project overview saved');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save project overview');
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-sm font-semibold text-gray-900 mb-3">Opportunity</div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Status">
            <Select disabled={!canEdit} value={opportunityStatus} onChange={(e) => setOpportunityStatus(e.target.value as ProjectRow['opportunityStatus'])}>
              <option value="pipeline">Pipeline</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="on-hold">On hold</option>
            </Select>
          </Field>
          <Field label="Opportunity value" hint="Whole currency units (e.g. 25000)">
            <Input disabled={!canEdit} type="number" min={0} step={1} value={opportunityValueText} onChange={(e) => setOpportunityValueText(e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 text-xs text-gray-500">
          Time spent so far: <span className="font-semibold text-gray-700">{Math.round(project.timeSpentMin / 60)}h ({project.timeSpentMin} min)</span>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-gray-900">Contacts</div>
          {canEdit && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setContacts((prev) => [...prev, blankContact()])}
            >
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
                    <Input disabled={!canEdit} value={contact.name} onChange={(e) => onContactChange(contact.id, { name: e.target.value })} />
                  </Field>
                  <Field label="Role">
                    <Input disabled={!canEdit} value={contact.role ?? ''} onChange={(e) => onContactChange(contact.id, { role: e.target.value })} placeholder="e.g. Director, Procurement" />
                  </Field>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Field label="Email">
                    <Input disabled={!canEdit} type="email" value={contact.email ?? ''} onChange={(e) => onContactChange(contact.id, { email: e.target.value })} />
                  </Field>
                  <Field label="Phone">
                    <Input disabled={!canEdit} value={contact.phone ?? ''} onChange={(e) => onContactChange(contact.id, { phone: e.target.value })} />
                  </Field>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-4">
                    <Checkbox label="Can market to this contact" checked={!!contact.canMarket} onChange={(v) => onContactChange(contact.id, { canMarket: v })} disabled={!canEdit} />
                    <Checkbox label="POC" checked={!!contact.isPoc} onChange={(v) => onContactChange(contact.id, { isPoc: v })} disabled={!canEdit} />
                  </div>
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setContacts((prev) => prev.filter((c) => c.id !== contact.id))}
                    >
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
          <Button variant="primary" onClick={onSave} disabled={updateProject.isPending}>
            Save overview
          </Button>
        </div>
      )}
    </div>
  );
}
