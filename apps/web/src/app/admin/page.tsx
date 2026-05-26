'use client';

import { useState, useEffect } from 'react';
import { Trash2, Download, Mail, X } from 'lucide-react';
import { API_URL } from '@/lib/env';
import { Card, Section, Pill, Empty, Tile } from '@/components/ui';
import {
  useGmailStatus,
  useDisconnectGmail,
  useConnectedGmailUsers,
  gmailConnectUrl,
} from '@/hooks/useGmail';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Checkbox } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { UserFormModal } from '@/components/features/UserFormModal';
import { ClientFormModal } from '@/components/features/ClientFormModal';
import { ProjectFormModal } from '@/components/features/ProjectFormModal';
import { LinkFolderModal } from '@/components/features/LinkFolderModal';
import {
  useUsers,
  useClients,
  useProjects,
  useDeleteUser,
  usePayPeriods,
  usePayConfig,
  useUpdatePayConfig,
  useGeneratePeriods,
  useIntegrations,
  useConnectIntegration,
  useDisconnectIntegration,
  useSyncDrive,
  useDriveFolders,
  useUnlinkDriveFolder,
  useGroups,
  usePermissionsCatalog,
  useCreateGroup,
  useUpdateGroup,
  useDeleteGroup,
  useSetGroupPermissions,
  type UserRow,
  useSettings,
  useUpdateSettings,
  type ClientRow,
  type ProjectRow,
  type GroupRow,
} from '@/hooks/useResources';
import { useAuth } from '@/hooks/useAuth';
import { PAY_PERIOD_STATUS_LABEL, PAY_PERIOD_STATUS_PILL } from '@/lib/formatters';
import type { Permission } from '@allebrum/shared';

type Tab = 'users' | 'groups' | 'auth' | 'workspace' | 'pay' | 'integrations';

export default function AdminPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('users');

  const hasAnyAdmin =
    can('users.manage') ||
    can('groups.manage') ||
    can('pay.manage') ||
    can('clients.manage') ||
    can('projects.manage') ||
    can('integrations.manage');

  if (!hasAnyAdmin) {
    return <Empty title="Admin access only" description="You don't have permission to manage workspace settings." />;
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow">Admin</div>
        <h1 className="text-2xl font-bold text-gray-900">Workspace settings</h1>
      </div>

      <div className="flex items-center gap-2 border-b border-gray-200 overflow-x-auto whitespace-nowrap">
        {(
          [
            { id: 'users', label: 'Team' },
            { id: 'groups', label: 'Groups & Permissions' },
            { id: 'auth', label: 'Authentication' },
            { id: 'workspace', label: 'Clients & Projects' },
            { id: 'pay', label: 'Pay periods' },
            { id: 'integrations', label: 'Integrations' },
          ] as { id: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`shrink-0 px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
              tab === t.id ? 'border-brand-600 text-brand-700' : 'border-transparent text-gray-500 hover:text-gray-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'users' && <UsersTab />}
      {tab === 'groups' && <GroupsTab />}
      {tab === 'auth' && <AuthSettingsTab />}
      {tab === 'workspace' && <WorkspaceTab />}
      {tab === 'pay' && <PayTab />}
      {tab === 'integrations' && <IntegrationsTab />}
    </div>
  );
}

function UsersTab() {
  const { me, can } = useAuth();
  const toast = useToast();
  const { data: users = [] } = useUsers();
  const remove = useDeleteUser();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const canManage = can('users.manage');

  return (
    <Section
      title="Team"
      action={canManage ? <Button variant="primary" onClick={() => { setEditing(null); setModalOpen(true); }}>Invite</Button> : null}
    >
      <Card>
        <ul className="divide-y divide-gray-100">
          {users.map((u) => (
            <li
              key={u.id}
              className={`px-5 py-3 flex items-center gap-3 ${canManage ? 'hover:bg-gray-50 cursor-pointer' : ''}`}
              onClick={() => { if (canManage) { setEditing(u); setModalOpen(true); } }}
            >
              <Avatar user={u} size={32} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-900">{u.name}</div>
                <div className="text-[12px] text-gray-500">{u.email}</div>
              </div>
              <Pill tone={u.status === 'invited' ? 'yellow' : 'gray'}>{u.status}</Pill>
              <span className="text-xs text-gray-500 tabular-nums">${u.billable}/hr</span>
              {canManage && me?.id !== u.id && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      await remove.mutateAsync(u.id);
                      toast.success(`${u.name} removed`);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Remove failed');
                    }
                  }}
                  className="text-gray-300 hover:text-red-600"
                  title="Remove"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </Card>
      <UserFormModal open={modalOpen} onClose={() => setModalOpen(false)} user={editing} />
    </Section>
  );
}

function GroupsTab() {
  const { can } = useAuth();
  const toast = useToast();
  const { data: groups = [] } = useGroups();
  const { data: catalog = [] } = usePermissionsCatalog();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const setPerms = useSetGroupPermissions();
  const canManage = can('groups.manage');
  const [newName, setNewName] = useState('');

  const byCategory = catalog.reduce<Record<string, typeof catalog>>((acc, p) => {
    (acc[p.category || 'Other'] ||= []).push(p);
    return acc;
  }, {});

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    }
  };

  if (!canManage) {
    return <Empty title="Permission required" description="You need the 'Manage groups & permissions' permission." />;
  }

  const togglePerm = (g: GroupRow, perm: string, on: boolean) => {
    const next = on ? [...g.permissions, perm] : g.permissions.filter((p) => p !== perm);
    return run(
      () => setPerms.mutateAsync({ id: g.id, permissions: next as Permission[] }),
      'Permissions updated',
    );
  };

  return (
    <Section
      title="Groups & Permissions"
      action={
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New group name"
            className="w-48"
          />
          <Button
            variant="primary"
            disabled={!newName.trim() || createGroup.isPending}
            onClick={async () => {
              await run(() => createGroup.mutateAsync({ name: newName.trim(), description: '', require2fa: false }), 'Group created');
              setNewName('');
            }}
          >
            Add group
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {groups.map((g) => (
          <Card key={g.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-900">{g.name}</span>
                  {g.isSystem && <Pill tone="gray">system</Pill>}
                </div>
                <div className="text-[12px] text-gray-500">{g.description || '—'}</div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  label="Require 2FA"
                  checked={g.require2fa}
                  onChange={(v) => run(() => updateGroup.mutateAsync({ id: g.id, patch: { require2fa: v } }), 'Group updated')}
                />
                {!g.isSystem && (
                  <button
                    onClick={() => run(() => deleteGroup.mutateAsync(g.id), 'Group deleted')}
                    className="text-gray-300 hover:text-red-600"
                    title="Delete group"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
              {Object.entries(byCategory).map(([cat, perms]) => (
                <div key={cat}>
                  <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">{cat}</div>
                  <div className="space-y-1">
                    {perms.map((p) => (
                      <Checkbox
                        key={p.key}
                        label={p.label}
                        checked={g.permissions.includes(p.key)}
                        onChange={(on) => togglePerm(g, p.key, on)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
        {groups.length === 0 && <Empty title="No groups yet" description="Create a group to start assigning permissions." />}
      </div>
    </Section>
  );
}

function AuthSettingsTab() {
  const { can } = useAuth();
  const toast = useToast();
  const { data: settings } = useSettings();
  const upd = useUpdateSettings();
  const canManage = can('groups.manage');
  const [domains, setDomains] = useState('');

  if (!canManage) {
    return <Empty title="Permission required" description="You need the 'Manage groups & permissions' permission." />;
  }
  if (!settings) return null;

  const save = async (patch: Parameters<typeof upd.mutateAsync>[0], ok: string) => {
    try {
      await upd.mutateAsync(patch);
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    }
  };

  return (
    <Section title="Authentication">
      <Card className="p-5 space-y-5 max-w-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-gray-900">Email &amp; password sign-in</div>
            <div className="text-[12px] text-gray-500">When off, only Google sign-in is allowed (server-enforced).</div>
          </div>
          <Checkbox
            label=""
            checked={settings.passwordLoginEnabled}
            onChange={(v) => save({ passwordLoginEnabled: v }, 'Settings updated')}
          />
        </div>
        <div className="flex items-start justify-between gap-4 border-t border-gray-100 pt-4">
          <div>
            <div className="text-sm font-semibold text-gray-900">Google sign-in</div>
            <div className="text-[12px] text-gray-500">
              Requires GOOGLE_OAUTH_CLIENT_ID / SECRET / OAUTH_REDIRECT_URL on the API.
            </div>
          </div>
          <Checkbox
            label=""
            checked={settings.googleLoginEnabled}
            onChange={(v) => save({ googleLoginEnabled: v }, 'Settings updated')}
          />
        </div>
        <div className="border-t border-gray-100 pt-4">
          <Field
            label="Allowed Google email domains"
            hint="Comma-separated (e.g. allebrum.com). Empty = any verified Google account."
          >
            <Input
              defaultValue={settings.allowedEmailDomains.join(', ')}
              onChange={(e) => setDomains(e.target.value)}
              placeholder="allebrum.com"
            />
          </Field>
          <div className="mt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                save(
                  {
                    allowedEmailDomains: domains
                      .split(',')
                      .map((d) => d.trim().toLowerCase())
                      .filter(Boolean),
                  },
                  'Allowed domains updated',
                )
              }
            >
              Save domains
            </Button>
          </div>
        </div>
      </Card>
    </Section>
  );
}

function WorkspaceTab() {
  const { data: clients = [] } = useClients();
  const { data: projects = [] } = useProjects();
  const [cOpen, setCOpen] = useState(false);
  const [cEditing, setCEditing] = useState<ClientRow | null>(null);
  const [pOpen, setPOpen] = useState(false);
  const [pEditing, setPEditing] = useState<ProjectRow | null>(null);

  return (
    <>
      <Section title="Clients" action={<Button variant="outline" onClick={() => { setCEditing(null); setCOpen(true); }}>Add client</Button>}>
        <Card>
          <ul className="divide-y divide-gray-100">
            {clients.map((c) => (
              <li
                key={c.id}
                className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50 cursor-pointer"
                onClick={() => { setCEditing(c); setCOpen(true); }}
              >
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c.color }} />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-900">{c.name}</div>
                  <div className="text-[11px] text-gray-500 capitalize">{c.kind}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section title="Projects" action={<Button variant="outline" onClick={() => { setPEditing(null); setPOpen(true); }}>Add project</Button>}>
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
            <thead className="text-left text-[11px] uppercase text-gray-400 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3">Project</th>
                <th className="px-4 py-3">Client</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3 text-right">Budget</th>
                <th className="px-4 py-3">Billable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {projects.map((p) => (
                <tr
                  key={p.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => { setPEditing(p); setPOpen(true); }}
                >
                  <td className="px-4 py-3 text-gray-900 font-semibold">{p.name}</td>
                  <td className="px-4 py-3 text-gray-700">{clients.find((c) => c.id === p.clientId)?.name}</td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{p.code}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{p.budgetHrs}h</td>
                  <td className="px-4 py-3">{p.billable ? <Pill tone="green">Billable</Pill> : <Pill tone="gray">Internal</Pill>}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
      </Section>

      <ClientFormModal open={cOpen} onClose={() => setCOpen(false)} client={cEditing} />
      <ProjectFormModal open={pOpen} onClose={() => setPOpen(false)} project={pEditing} />
    </>
  );
}

function PayTab() {
  const toast = useToast();
  const { data: periods = [] } = usePayPeriods();
  const { data: config } = usePayConfig();
  const upd = useUpdatePayConfig();
  const gen = useGeneratePeriods();
  const [count, setCount] = useState(6);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  // Local mirror of the anchor date so the date input stays controlled
  // while the user types. Synced from server whenever the config changes
  // (e.g. after a successful PATCH from another tab or a fresh load).
  const [anchor, setAnchor] = useState('');
  useEffect(() => {
    if (config) setAnchor(config.anchor ?? '');
  }, [config?.anchor]);

  if (!config) return null;

  const patch = async (p: Parameters<typeof upd.mutateAsync>[0]) => {
    try {
      await upd.mutateAsync(p);
      toast.success('Pay schedule updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    }
  };

  // CSV exports are downloads, not fetches — point the browser at the
  // endpoint so the response triggers a "save file" with cookies attached.
  const exportPeriod = (periodId: string) => {
    window.location.assign(`${API_URL}/api/entries/export.csv?periodId=${encodeURIComponent(periodId)}`);
  };
  const exportRange = () => {
    if (!from || !to) {
      toast.error('Pick a start and end date');
      return;
    }
    if (from > to) {
      toast.error('Start date must be on or before end date');
      return;
    }
    const params = new URLSearchParams({ from, to });
    window.location.assign(`${API_URL}/api/entries/export.csv?${params.toString()}`);
  };

  return (
    <>
      <Section title="Schedule">
        <Card className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Cadence">
            <Select value={config.cadence} onChange={(e) => patch({ cadence: e.target.value as typeof config.cadence })}>
              <option value="by-date">Monthly · custom dates</option>
              <option value="weekly">Weekly</option>
              <option value="bi-weekly">Bi-weekly</option>
            </Select>
          </Field>
          <Field label="Weekend rule">
            <Select value={config.weekendRule} onChange={(e) => patch({ weekendRule: e.target.value as typeof config.weekendRule })}>
              <option value="prior">Shift to prior business day</option>
              <option value="after">Shift to next business day</option>
              <option value="as-is">Leave as-is</option>
            </Select>
          </Field>

          {config.cadence === 'by-date' && (
            <div className="md:col-span-2">
              <Field
                label="Pay dates"
                hint="Days of the month each pay period closes on. Up to 8. Dates beyond a month's last day clamp to that month's end (e.g. picking 31 in February uses the 28th)."
              >
                <PayDatesEditor
                  value={config.payDates}
                  onChange={(next) => patch({ payDates: next })}
                  disabled={upd.isPending}
                />
              </Field>
            </div>
          )}

          {config.cadence !== 'by-date' && (
            <div className="md:col-span-2">
              <Field
                label="Cycle start (anchor)"
                hint={`First period starts on this day; subsequent ${config.cadence === 'weekly' ? 'weekly (7-day)' : 'bi-weekly (14-day)'} cycles march forward from here.`}
              >
                <Input
                  type="date"
                  value={anchor}
                  onChange={(e) => setAnchor(e.target.value)}
                  onBlur={() => {
                    const next = anchor || null;
                    if (next !== (config.anchor ?? null)) patch({ anchor: next });
                  }}
                  className="max-w-xs"
                />
              </Field>
            </div>
          )}

          <Field label="Processing buffer (days)">
            <Input type="number" min={0} defaultValue={config.processingBufferDays} onBlur={(e) => patch({ processingBufferDays: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="Pay delay (days)">
            <Input type="number" min={0} defaultValue={config.payDelayDays} onBlur={(e) => patch({ payDelayDays: Number(e.target.value) || 0 })} />
          </Field>
          <Field label="Auto-close at cutoff">
            <div className="pt-2"><Checkbox label="Auto-close periods at the approval cutoff" checked={config.autoClose} onChange={(v) => patch({ autoClose: v })} /></div>
          </Field>
        </Card>
      </Section>

      <Section
        title="Periods"
        action={
          <div className="flex items-center gap-2">
            <Input className="w-24" type="number" min={1} max={24} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} />
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  const { inserted } = await gen.mutateAsync({ count });
                  toast.success(`${inserted} period${inserted === 1 ? '' : 's'} generated`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Generate failed');
                }
              }}
            >
              Generate next {count}
            </Button>
          </div>
        }
      >
        <Card>
          <ul className="divide-y divide-gray-100">
            {periods.map((p) => (
              <li key={p.id} className="px-5 py-3 flex items-center gap-3">
                <div className="flex-1">
                  <div className="text-sm font-semibold text-gray-900">{p.label}</div>
                  <div className="text-[11px] text-gray-500">Cutoff {p.approvalCutoff} · Pay {p.payDate}</div>
                </div>
                <Pill tone={PAY_PERIOD_STATUS_PILL[p.status]}>{PAY_PERIOD_STATUS_LABEL[p.status]}</Pill>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => exportPeriod(p.id)}
                  title={`Download CSV for ${p.label}`}
                >
                  <Download className="w-3.5 h-3.5" /> CSV
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      <Section title="Custom range export">
        <Card className="p-5">
          <p className="text-sm text-gray-600 mb-3">
            Download a CSV of every time entry whose start date falls in the picked range.
            Use this for off-cycle exports or audits that don't line up with a pay period.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="From">
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="w-44"
              />
            </Field>
            <Field label="To">
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="w-44"
              />
            </Field>
            <Button variant="primary" onClick={exportRange}>
              <Download className="w-4 h-4" /> Export CSV
            </Button>
          </div>
        </Card>
      </Section>
    </>
  );
}

/**
 * Chip-style editor for the `payConfig.payDates` array.
 *
 * Renders each currently-selected day as a removable chip ("15th",
 * "Last day", etc.) and offers a trailing `<select>` to add another.
 * Hard-capped at 8 entries; the array can't drop below 1 — removing the
 * last chip is blocked so the server never sees an empty list (which the
 * backend would silently coerce back to `[15, 'last']` anyway).
 *
 * Values are persisted via the parent's `onChange` immediately on each
 * add/remove — no local "save" button. Sort order is numeric ascending
 * with `'last'` always trailing.
 */
function PayDatesEditor({
  value,
  onChange,
  disabled,
}: {
  value: (number | 'last')[];
  onChange: (next: (number | 'last')[]) => void;
  disabled?: boolean;
}) {
  const MAX = 8;
  const sorted = [...value].sort((a, b) => {
    if (a === 'last') return 1;
    if (b === 'last') return -1;
    return (a as number) - (b as number);
  });
  const used = new Set(sorted.map(String));
  const atMin = sorted.length <= 1;
  const atMax = sorted.length >= MAX;

  const remove = (d: number | 'last') => {
    if (atMin) return;
    onChange(sorted.filter((x) => x !== d));
  };

  const add = (raw: string) => {
    if (!raw || atMax) return;
    const v: number | 'last' = raw === 'last' ? 'last' : Number(raw);
    if (sorted.includes(v)) return;
    onChange([...sorted, v]);
  };

  return (
    <div className="flex items-center flex-wrap gap-1.5">
      {sorted.map((d) => (
        <span
          key={String(d)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-brand-50 border border-brand-200 text-brand-800 text-xs font-semibold"
        >
          {payDateLabel(d)}
          <button
            type="button"
            onClick={() => remove(d)}
            disabled={disabled || atMin}
            className="text-brand-500 hover:text-brand-700 disabled:opacity-40 disabled:cursor-not-allowed"
            title={atMin ? 'At least one pay date is required' : `Remove ${payDateLabel(d)}`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
      {/* Inline "+ Add date" select — placeholder option resets after add. */}
      <select
        value=""
        onChange={(e) => {
          add(e.target.value);
          e.currentTarget.value = '';
        }}
        disabled={disabled || atMax}
        className="px-2 py-1 text-xs border border-gray-200 rounded-md bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
        aria-label="Add another pay date"
      >
        <option value="">{atMax ? `Maxed (${MAX})` : '+ Add date'}</option>
        {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d} disabled={used.has(String(d))}>
            {payDateLabel(d)}
          </option>
        ))}
        <option value="last" disabled={used.has('last')}>Last day of month</option>
      </select>
    </div>
  );
}

function payDateLabel(d: number | 'last'): string {
  if (d === 'last') return 'Last day';
  return `${d}${ordinalSuffix(d)}`;
}

function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

function IntegrationsTab() {
  const toast = useToast();
  const { data: integrations = [] } = useIntegrations();
  const { data: folders = [] } = useDriveFolders();
  const { data: clients = [] } = useClients();
  const connect = useConnectIntegration();
  const disconnect = useDisconnectIntegration();
  const sync = useSyncDrive();
  const unlink = useUnlinkDriveFolder();
  const [linkOpen, setLinkOpen] = useState(false);

  const byKind = (k: string) => integrations.find((i) => i.kind === k);
  const drive = byKind('drive');

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed');
    }
  };

  return (
    <>
      <Section title="Connected services">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(['drive', 'github', 'slack', 'quickbooks'] as const).map((kind) => {
            const i = byKind(kind);
            const connected = !!i?.connected;
            return (
              <Tile key={kind}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-gray-900 capitalize">{kind === 'drive' ? 'Google Drive' : kind}</div>
                    <div className="text-[12px] text-gray-500">{i?.account ?? (connected ? 'connected' : 'not connected')}</div>
                    {i?.lastSyncAt && <div className="text-[11px] text-gray-400 mt-1">Last sync {new Date(i.lastSyncAt).toLocaleString()}</div>}
                  </div>
                  {connected ? (
                    <Button variant="ghost" size="sm" onClick={() => run(() => disconnect.mutateAsync(kind), `${kind} disconnected`)}>Disconnect</Button>
                  ) : (
                    <Button variant="primary" size="sm" onClick={() => run(() => connect.mutateAsync({ kind, input: {} }), `${kind} connected`)}>Connect</Button>
                  )}
                </div>
              </Tile>
            );
          })}
        </div>
      </Section>

      {drive?.connected && (
        <Section
          title="Drive folders"
          action={
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => setLinkOpen(true)}>Link folder</Button>
              <Button variant="ghost" onClick={() => run(() => sync.mutateAsync(), 'Google Drive synced')}>Sync now</Button>
            </div>
          }
        >
          <Card>
            <ul className="divide-y divide-gray-100">
              {folders.map((f) => {
                const c = clients.find((x) => x.id === f.clientId);
                return (
                  <li key={f.id} className="px-5 py-3 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-gray-900 truncate">{f.drivePath}</div>
                      <div className="text-[11px] text-gray-500">Linked to {c?.name} · {f.itemCount} items</div>
                    </div>
                    <span className="text-[11px] text-gray-400">Last sync {new Date(f.lastSync).toLocaleDateString()}</span>
                    <button
                      onClick={() => run(() => unlink.mutateAsync(f.id), 'Folder unlinked')}
                      className="text-gray-300 hover:text-red-600"
                      title="Unlink"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </li>
                );
              })}
              {folders.length === 0 && <li className="px-5 py-3 text-sm text-gray-500">No folders linked yet.</li>}
            </ul>
          </Card>
        </Section>
      )}

      <GmailIntegrationPanel />

      <LinkFolderModal open={linkOpen} onClose={() => setLinkOpen(false)} />
    </>
  );
}

/**
 * Per-user Gmail OAuth tile + workspace system-sender designation.
 *
 * Lives inside IntegrationsTab so it sits next to Drive. The Connect /
 * Disconnect buttons act on the *currently logged-in* user's mailbox.
 * The system-sender dropdown is admin-only (gated server-side by
 * `groups.manage`) and only lists teammates who actually have a Gmail
 * token persisted — preventing the workspace from being left in a state
 * where reset emails silently fail because the picked user never finished
 * the OAuth flow.
 */
function GmailIntegrationPanel() {
  const toast = useToast();
  const { data: status } = useGmailStatus();
  const { can } = useAuth();
  const canManageWorkspace = can('groups.manage');
  const { data: settings } = useSettings();
  const updSettings = useUpdateSettings();
  const { data: connected = [] } = useConnectedGmailUsers(canManageWorkspace);
  const disconnect = useDisconnectGmail();

  // Surface the result of the OAuth round-trip when the callback redirects
  // here with `?gmail=connected|bad_state|error`.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get('gmail');
    if (!flag) return;
    if (flag === 'connected') toast.success('Gmail connected — you can now send invites as yourself.');
    else if (flag === 'bad_state') toast.error('Gmail consent expired or was tampered with. Try again.');
    else toast.error('Gmail connect failed. Try again.');
    // Clean up the URL so a reload doesn't re-fire the toast.
    params.delete('gmail');
    const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`;
    window.history.replaceState({}, '', next);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onDisconnect = async () => {
    try {
      await disconnect.mutateAsync();
      toast.success('Gmail disconnected');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Disconnect failed');
    }
  };

  const onSetSender = async (v: string) => {
    try {
      await updSettings.mutateAsync({ systemSenderUserId: v === '' ? null : v });
      toast.success(v ? 'System sender updated' : 'System sender cleared');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not update system sender';
      toast.error(msg === 'system_sender_not_connected' ? 'Pick a teammate who has actually connected Gmail.' : msg);
    }
  };

  return (
    <Section title="Gmail (transactional sends)">
      <Card className="p-5 space-y-5">
        <p className="text-sm text-gray-600">
          Each teammate sends invites from their own Gmail account. The workspace also designates
          one connected account as the <strong>system sender</strong> for password-reset emails —
          those happen without a logged-in user, so they need a stable mailbox to send through.
        </p>

        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900">Your Gmail</div>
            <div className="text-[12px] text-gray-500">
              {status?.connected
                ? `Connected${status.lastConnectedAt ? ` · ${new Date(status.lastConnectedAt).toLocaleDateString()}` : ''}`
                : 'Not connected — invites you send will fall back to a logged URL until you connect.'}
            </div>
          </div>
          {status?.connected ? (
            <Button variant="ghost" onClick={onDisconnect} disabled={disconnect.isPending}>
              Disconnect
            </Button>
          ) : (
            <a href={gmailConnectUrl('/admin?tab=integrations')}>
              <Button variant="primary">
                <Mail className="w-4 h-4" /> Connect Gmail
              </Button>
            </a>
          )}
        </div>

        {canManageWorkspace && (
          <div className="pt-4 border-t border-gray-100">
            <div className="text-sm font-semibold text-gray-900 mb-1">System sender</div>
            <div className="text-[12px] text-gray-500 mb-2">
              Sends password-reset emails on behalf of the workspace. Only teammates with a connected Gmail can be picked.
            </div>
            <Select
              value={settings?.systemSenderUserId ?? ''}
              onChange={(e) => void onSetSender(e.target.value)}
              disabled={updSettings.isPending}
              className="max-w-md"
            >
              <option value="">— No system sender (reset emails will be logged-only) —</option>
              {connected.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} · {u.email}
                </option>
              ))}
            </Select>
            {connected.length === 0 && (
              <div className="mt-2 text-[12px] text-amber-600">
                Nobody has connected Gmail yet. Once a teammate connects above, you can designate them here.
              </div>
            )}
          </div>
        )}

      </Card>
    </Section>
  );
}
