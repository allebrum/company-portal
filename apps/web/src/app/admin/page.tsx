'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Card, Section, Pill, Empty, Tile } from '@/components/ui';
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

      <div className="flex items-center gap-2 border-b border-gray-200">
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
            className={`px-3 py-2 text-sm font-semibold border-b-2 -mb-px transition-colors ${
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
          <table className="w-full text-sm">
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
          </table>
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

  if (!config) return null;

  const patch = async (p: Parameters<typeof upd.mutateAsync>[0]) => {
    try {
      await upd.mutateAsync(p);
      toast.success('Pay schedule updated');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Update failed');
    }
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
              </li>
            ))}
          </ul>
        </Card>
      </Section>
    </>
  );
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

      <LinkFolderModal open={linkOpen} onClose={() => setLinkOpen(false)} />
    </>
  );
}
