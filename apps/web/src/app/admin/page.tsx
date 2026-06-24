'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, Plus, Search, Trash2, Download, Mail, Users as UsersIcon, X, Link2, Copy } from 'lucide-react';
import { API_URL } from '@/lib/env';
import { Card, Section, Pill, Empty, Tile } from '@/components/ui';
import {
  useGmailStatus,
  useDisconnectGmail,
  useConnectedGmailUsers,
  gmailConnectUrl,
} from '@/hooks/useGmail';
import { Avatar, AvatarStack } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Popover';
import { Field, Input, Select, Checkbox } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { UserFormModal } from '@/components/features/UserFormModal';
import { ClientFormModal } from '@/components/features/ClientFormModal';
import { ProjectFormModal } from '@/components/features/ProjectFormModal';
import { LinkFolderModal } from '@/components/features/LinkFolderModal';
import {
  useReconcileDriveFolders,
  useDisconnectDrive,
  useDriveStatus,
  driveConnectUrl,
  type DriveReconciliationReport,
} from '@/hooks/useDrive';
import {
  useActiveQrUploadSessions,
  useQrUploadSessionFiles,
  useRevokeQrUploadSession,
} from '@/hooks/useQrUploadSession';
import {
  useUsers,
  useClients,
  useProjects,
  useDeleteUser,
  usePayPeriods,
  usePayConfig,
  useUpdatePayConfig,
  useRecalculatePayPeriods,
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
  useGroupMembers,
  useAddUserToGroup,
  useRemoveUserFromGroup,
  type UserRow,
  useSettings,
  useUpdateSettings,
  type ClientRow,
  type ProjectRow,
  type GroupRow,
} from '@/hooks/useResources';
import { useAuth } from '@/hooks/useAuth';
import { PAY_PERIOD_STATUS_LABEL, PAY_PERIOD_STATUS_PILL } from '@/lib/formatters';
import type { Permission } from '@modernzen/shared';

type Tab = 'users' | 'groups' | 'auth' | 'workspace' | 'pay' | 'integrations' | 'branding';
const ADMIN_TAB_PARAM = 'adminTab';
const TAB_IDS: ReadonlyArray<Tab> = ['users', 'groups', 'auth', 'workspace', 'pay', 'integrations', 'branding'];

function readAdminTabFromUrl(): Tab | null {
  const raw = new URL(window.location.href).searchParams.get(ADMIN_TAB_PARAM);
  if (!raw) return null;
  return TAB_IDS.includes(raw as Tab) ? (raw as Tab) : null;
}

function writeAdminTabToUrl(tab: Tab): void {
  const url = new URL(window.location.href);
  url.searchParams.set(ADMIN_TAB_PARAM, tab);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export default function AdminPage() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Tab>('users');

  const onTabChange = (next: Tab) => {
    setTab(next);
    writeAdminTabToUrl(next);
  };

  useEffect(() => {
    const fromUrl = readAdminTabFromUrl();
    const next = fromUrl ?? 'users';
    setTab(next);
    if (!fromUrl) writeAdminTabToUrl(next);

    const onPopState = () => {
      const popped = readAdminTabFromUrl();
      setTab(popped ?? 'users');
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

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
            { id: 'branding', label: 'Branding' },
          ] as { id: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.id}
            onClick={() => onTabChange(t.id)}
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
      {tab === 'branding' && <BrandingTab />}
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

/**
 * F25 — redesigned Groups & Permissions tab.
 *
 * - Each group is a collapsible card; collapsed shows name + counts + 2FA pill.
 * - Expanded reveals three sub-sections: Permissions (removable pills + "+ Add"
 *   Popover grouped by category), Members (AvatarStack + "+ Add member"
 *   Popover with searchable user list + per-avatar remove), Settings
 *   (Require 2FA + Delete).
 * - Top of tab: "+ New group" + filter input.
 *
 * Reuses existing hooks: `useGroups`, `usePermissionsCatalog`,
 * `useSetGroupPermissions`. Adds F25 hooks `useGroupMembers`,
 * `useAddUserToGroup`, `useRemoveUserFromGroup`.
 */
function GroupsTab() {
  const { can } = useAuth();
  const toast = useToast();
  const { data: groups = [] } = useGroups();
  const { data: catalog = [] } = usePermissionsCatalog();
  const createGroup = useCreateGroup();
  const canManage = can('groups.manage');
  const [newName, setNewName] = useState('');
  const [filter, setFilter] = useState('');

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

  const visibleGroups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? groups.filter((g) => g.name.toLowerCase().includes(q)) : groups;
  }, [groups, filter]);

  return (
    <Section
      title="Groups & Permissions"
      action={
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter groups…"
              className="w-44 pl-7"
            />
          </div>
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New group name"
            className="w-44"
          />
          <Button
            variant="primary"
            disabled={!newName.trim() || createGroup.isPending}
            onClick={async () => {
              // F25: new groups require 2FA by default — matches the
              // column default introduced in migration 0015.
              await run(
                () => createGroup.mutateAsync({ name: newName.trim(), description: '', require2fa: true }),
                'Group created',
              );
              setNewName('');
            }}
          >
            <Plus className="w-3.5 h-3.5" /> Add group
          </Button>
        </div>
      }
    >
      <div className="space-y-3">
        {visibleGroups.map((g) => (
          <GroupCard key={g.id} group={g} catalog={catalog} run={run} />
        ))}
        {visibleGroups.length === 0 && groups.length === 0 && (
          <Empty title="No groups yet" description="Create a group to start assigning permissions." />
        )}
        {visibleGroups.length === 0 && groups.length > 0 && (
          <Empty title="No matches" description={`No group matches "${filter}".`} />
        )}
      </div>
    </Section>
  );
}

/**
 * F25 — single collapsible group card. Expand/collapse state is local
 * (collapsed by default). Owns its own member-load query so a tab with 30
 * groups doesn't fan out 30 requests on mount; the query is gated on
 * expanded state via `useGroupMembers(expanded ? id : null)`.
 */
function GroupCard({
  group,
  catalog,
  run,
}: {
  group: GroupRow;
  catalog: { key: string; label: string; category: string }[];
  run: (fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const updateGroup = useUpdateGroup();
  const deleteGroup = useDeleteGroup();
  const setPerms = useSetGroupPermissions();
  const addUser = useAddUserToGroup();
  const removeUser = useRemoveUserFromGroup();
  const { data: users = [] } = useUsers();
  const { data: memberIds = [] } = useGroupMembers(expanded ? group.id : null);

  const byCategory = useMemo(() => {
    return catalog.reduce<Record<string, typeof catalog>>((acc, p) => {
      (acc[p.category || 'Other'] ||= []).push(p);
      return acc;
    }, {});
  }, [catalog]);

  const members = useMemo(
    () => memberIds.map((id) => users.find((u) => u.id === id)).filter(Boolean) as UserRow[],
    [memberIds, users],
  );

  const togglePerm = (perm: string, on: boolean) => {
    const next = on ? [...group.permissions, perm] : group.permissions.filter((p) => p !== perm);
    return run(
      () => setPerms.mutateAsync({ id: group.id, permissions: next as Permission[] }),
      'Permissions updated',
    );
  };

  const removePerm = (perm: string) => {
    const next = group.permissions.filter((p) => p !== perm);
    return run(
      () => setPerms.mutateAsync({ id: group.id, permissions: next as Permission[] }),
      'Permission removed',
    );
  };

  const permLabel = (key: string): string => catalog.find((p) => p.key === key)?.label ?? key;

  return (
    <Card className="overflow-hidden">
      {/* Collapsed header — clickable. */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 p-4 text-left hover:bg-gray-50 transition-colors"
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-900">{group.name}</span>
            {group.isSystem && <Pill tone="gray">system</Pill>}
            {group.require2fa && <Pill tone="yellow">2FA</Pill>}
          </div>
          {group.description && (
            <div className="text-[12px] text-gray-500 truncate">{group.description}</div>
          )}
        </div>
        <span className="text-[11px] font-semibold text-gray-500 tabular-nums">
          {group.permissions.length} {group.permissions.length === 1 ? 'permission' : 'permissions'}
        </span>
        <span className="text-[11px] font-semibold text-gray-500 tabular-nums">
          {expanded ? `${memberIds.length} ${memberIds.length === 1 ? 'member' : 'members'}` : '· members'}
        </span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 p-5 space-y-6 bg-gray-50/40">
          {/* Permissions — pills + add Popover. */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Permissions</h3>
              <AddPermissionButton
                byCategory={byCategory}
                assigned={group.permissions}
                onAdd={(perm) => togglePerm(perm, true)}
              />
            </div>
            {group.permissions.length === 0 ? (
              <div className="text-[12px] text-gray-400 italic">No permissions yet — click "+ Add" to grant the first.</div>
            ) : (
              <PermissionPillCloud
                permissions={group.permissions}
                permLabel={permLabel}
                onRemove={removePerm}
              />
            )}
          </div>

          {/* Members — AvatarStack + add Popover + per-avatar remove. */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">Members</h3>
              <AddMemberButton
                groupId={group.id}
                users={users}
                memberIds={memberIds}
                onAdd={(userId) =>
                  run(() => addUser.mutateAsync({ groupId: group.id, userId }), 'User added to group')
                }
              />
            </div>
            {members.length === 0 ? (
              <div className="text-[12px] text-gray-400 italic">No members yet.</div>
            ) : (
              <div className="flex items-center gap-3 flex-wrap">
                {members.map((m) => (
                  <div key={m.id} className="group inline-flex items-center gap-1.5">
                    <Avatar user={m} size={28} />
                    <span className="text-[12px] font-semibold text-gray-700">{m.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        run(
                          () => removeUser.mutateAsync({ groupId: group.id, userId: m.id }),
                          `Removed ${m.name} from group`,
                        )
                      }
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-red-600"
                      title={`Remove ${m.name}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Settings — 2FA toggle + delete (system groups can't be deleted). */}
          <div>
            <h3 className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold mb-2">Settings</h3>
            <div className="flex items-center gap-4">
              <Checkbox
                label="Require 2FA"
                checked={group.require2fa}
                onChange={(v) =>
                  run(() => updateGroup.mutateAsync({ id: group.id, patch: { require2fa: v } }), 'Group updated')
                }
              />
              {!group.isSystem && (
                <button
                  type="button"
                  onClick={() => run(() => deleteGroup.mutateAsync(group.id), 'Group deleted')}
                  className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-semibold text-gray-400 hover:text-red-600"
                  title="Delete group"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Delete group
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

/**
 * Pills for assigned permissions, grouped by category. Each pill has an
 * "x" to remove. Lays out compactly so a 30-perm group still scans well.
 */
function PermissionPillCloud({
  permissions,
  permLabel,
  onRemove,
}: {
  permissions: string[];
  permLabel: (key: string) => string;
  onRemove: (perm: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {permissions.map((perm) => (
        <span
          key={perm}
          className="inline-flex items-center gap-1 rounded-full bg-brand-50 border border-brand-200 text-brand-800 px-2.5 py-0.5 text-[11px] font-semibold"
        >
          {permLabel(perm)}
          <button
            type="button"
            onClick={() => onRemove(perm)}
            className="text-brand-400 hover:text-red-600"
            aria-label={`Remove ${permLabel(perm)}`}
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      ))}
    </div>
  );
}

function AddPermissionButton({
  byCategory,
  assigned,
  onAdd,
}: {
  byCategory: Record<string, { key: string; label: string; category: string }[]>;
  assigned: string[];
  onAdd: (perm: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 text-gray-500 hover:text-brand-700 hover:border-brand-300 px-2.5 py-0.5 text-[11px] font-semibold"
      >
        <Plus className="w-3 h-3" /> Add permission
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} align="end" width={320}>
        <div className="w-80 max-h-80 overflow-y-auto p-3 space-y-3">
          {Object.entries(byCategory).map(([cat, perms]) => {
            const unassigned = perms.filter((p) => !assigned.includes(p.key));
            if (unassigned.length === 0) return null;
            return (
              <div key={cat}>
                <div className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold mb-1">{cat}</div>
                <div className="flex flex-wrap gap-1.5">
                  {unassigned.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => {
                        onAdd(p.key);
                        // Leave popover open so admins can grant several at once.
                      }}
                      className="inline-flex items-center gap-1 rounded-full border border-gray-200 hover:border-brand-300 hover:bg-brand-50 text-gray-700 hover:text-brand-700 px-2.5 py-0.5 text-[11px] font-semibold"
                    >
                      <Plus className="w-3 h-3" /> {p.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Popover>
    </>
  );
}

function AddMemberButton({
  groupId,
  users,
  memberIds,
  onAdd,
}: {
  groupId: string;
  users: UserRow[];
  memberIds: string[];
  onAdd: (userId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const anchor = useRef<HTMLButtonElement>(null);
  const candidates = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return users.filter(
      (u) =>
        !memberIds.includes(u.id) &&
        (!needle || u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle)),
    );
  }, [users, memberIds, q]);
  return (
    <>
      <button
        ref={anchor}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 text-gray-500 hover:text-brand-700 hover:border-brand-300 px-2.5 py-0.5 text-[11px] font-semibold"
      >
        <Plus className="w-3 h-3" /> Add member
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} align="end" width={280}>
        <div className="w-72 flex flex-col">
          <div className="p-2 border-b border-gray-100">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search teammates…"
              autoFocus
              className="w-full px-2 py-1.5 text-sm outline-none placeholder:text-gray-400"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {candidates.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-400">
                {users.length === memberIds.length ? 'Everyone is already in this group.' : 'No matches.'}
              </div>
            ) : (
              candidates.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    onAdd(u.id);
                    // Leave open so admins can add several in a row.
                    setQ('');
                  }}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-gray-50 inline-flex items-center gap-2"
                >
                  <Avatar user={u} size={20} />
                  <span className="truncate">{u.name}</span>
                  <span className="ml-auto text-[10px] text-gray-400 truncate">{u.email}</span>
                </button>
              ))
            )}
          </div>
        </div>
      </Popover>
    </>
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

/**
 * Workspace branding — portal name, primary color, logo upload, plus
 * external Terms/Privacy URLs that the login footer links to. All five
 * settings are exposed to the public `/auth/config` so the login page can
 * pick them up without authentication.
 *
 * The logo is converted to a base64 data URL on the client (FileReader)
 * and capped at 500KB before encoding — small enough to keep the
 * /auth/config payload reasonable and avoid a separate hosting story.
 */
function BrandingTab() {
  const { can } = useAuth();
  const canManage = can('groups.manage');
  const toast = useToast();
  const { data: settings } = useSettings();
  const upd = useUpdateSettings();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#9333ea');
  const [terms, setTerms] = useState('');
  const [privacy, setPrivacy] = useState('');
  const colorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!settings) return;
    setName(settings.portalName);
    setColor(settings.brandPrimaryColor);
    setTerms(settings.termsUrl ?? '');
    setPrivacy(settings.privacyUrl ?? '');
  }, [settings?.portalName, settings?.brandPrimaryColor, settings?.termsUrl, settings?.privacyUrl]);

  if (!canManage) {
    return <Empty title="Permission required" description="You need the 'Manage groups & permissions' permission to edit branding." />;
  }
  if (!settings) return null;

  const save = async (patch: Parameters<typeof upd.mutateAsync>[0], ok: string) => {
    try {
      await upd.mutateAsync(patch);
      toast.success(ok);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Update failed';
      toast.error(msg);
    }
  };

  const saveName = () => {
    const next = name.trim();
    if (!next || next === settings.portalName) return;
    void save({ portalName: next }, 'Portal name updated');
  };
  const saveColor = (v: string) => {
    setColor(v);
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) return;
    if (colorTimer.current) clearTimeout(colorTimer.current);
    colorTimer.current = setTimeout(() => {
      if (v === settings.brandPrimaryColor) return;
      void save({ brandPrimaryColor: v }, 'Brand color updated');
    }, 250);
  };
  const saveTerms = () => {
    const next = terms.trim() === '' ? null : terms.trim();
    if (next === (settings.termsUrl ?? null)) return;
    void save({ termsUrl: next }, 'Terms URL updated');
  };
  const savePrivacy = () => {
    const next = privacy.trim() === '' ? null : privacy.trim();
    if (next === (settings.privacyUrl ?? null)) return;
    void save({ privacyUrl: next }, 'Privacy URL updated');
  };

  const onLogoPick = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please pick an image file');
      return;
    }
    if (file.size > 500_000) {
      toast.error('Logo must be 500 KB or smaller');
      return;
    }
    const dataUrl = await readAsDataUrl(file);
    void save({ brandLogoDataUrl: dataUrl }, 'Logo updated');
  };
  const clearLogo = () => void save({ brandLogoDataUrl: null }, 'Logo removed');

  return (
    <>
      <Section title="Brand identity">
        <Card className="p-5 space-y-5">
          <Field label="Portal name" hint="Shows on the login card and sidebar.">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              placeholder="Modern Zen"
              maxLength={60}
              className="max-w-sm"
            />
          </Field>

          <Field
            label="Primary color"
            hint="Used on the login hero button, sidebar logo tile, and a few other accents. Hex #RRGGBB."
          >
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={color}
                onChange={(e) => saveColor(e.target.value)}
                className="w-12 h-9 rounded-lg border border-gray-200 bg-white cursor-pointer"
                aria-label="Pick brand color"
              />
              <Input
                value={color}
                onChange={(e) => saveColor(e.target.value)}
                placeholder="#9333ea"
                className="w-32 font-mono"
              />
              <div
                className="w-9 h-9 rounded-lg shadow-md"
                style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#9333ea' }}
              />
            </div>
          </Field>

          <Field
            label="Logo"
            hint="PNG, SVG, or any image up to 500 KB. Replaces the gradient letter tile on the login card and sidebar. Leave empty to use the first letter of the portal name."
          >
            <div className="flex items-center gap-4">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-md overflow-hidden"
                style={{ backgroundColor: settings.brandPrimaryColor }}
              >
                {settings.brandLogoDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={settings.brandLogoDataUrl} alt="Logo preview" className="w-full h-full object-contain" />
                ) : (
                  <span className="text-white text-2xl font-bold">{settings.portalName.charAt(0).toUpperCase() || 'A'}</span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onLogoPick(f);
                    e.target.value = '';
                  }}
                />
                <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  Upload logo
                </Button>
                {settings.brandLogoDataUrl && (
                  <Button variant="ghost" size="sm" onClick={clearLogo}>
                    Remove logo
                  </Button>
                )}
              </div>
            </div>
          </Field>
        </Card>
      </Section>

      <Section title="Legal links">
        <Card className="p-5 space-y-5">
          <p className="text-sm text-gray-600">
            Host your policies wherever you like (Notion, Google Sites, a marketing page) and paste the URLs here.
            The login footer shows each link only when its URL is set; clicking opens in a new tab.
          </p>
          <Field label="Terms of Service URL">
            <Input
              type="url"
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              onBlur={saveTerms}
              placeholder="https://allebrum.com/terms"
            />
          </Field>
          <Field label="Privacy Policy URL">
            <Input
              type="url"
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value)}
              onBlur={savePrivacy}
              placeholder="https://allebrum.com/privacy"
            />
          </Field>
        </Card>
      </Section>
    </>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('read_failed'));
    reader.readAsDataURL(file);
  });
}

function PayTab() {
  const toast = useToast();
  const { data: periods = [] } = usePayPeriods();
  const { data: config } = usePayConfig();
  const { data: settings } = useSettings();
  const upd = useUpdatePayConfig();
  const updSettings = useUpdateSettings();
  const recalc = useRecalculatePayPeriods();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [bookkeeperEmail, setBookkeeperEmail] = useState('');
  useEffect(() => {
    if (settings) setBookkeeperEmail(settings.bookkeeperEmail ?? '');
  }, [settings?.bookkeeperEmail]);
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
        <Card className="p-5 space-y-4">
          <p className="text-[12px] text-gray-500">
            Schedule changes apply to <strong>upcoming pay periods only</strong>. Already-started periods keep
            their original dates so existing time entries stay tied to consistent ranges. Each pay period ends
            <strong> {config.processingBufferDays} day{config.processingBufferDays === 1 ? '' : 's'} before its pay date</strong>
            {' '}(your current processing buffer); subsequent periods start the day after the prior period ends.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
          <Field label="Auto-close at cutoff">
            <div className="pt-2"><Checkbox label="Auto-close periods at the approval cutoff" checked={config.autoClose} onChange={(v) => patch({ autoClose: v })} /></div>
          </Field>

          <div className="md:col-span-2">
            <Field
              label="Bookkeeper emails"
              hint="Where the payroll report goes when an admin clicks 'Close & send to bookkeeper'. Separate multiple addresses with commas — the first gets the email, the rest are CC'd (up to 100, the Gmail limit)."
            >
              <Input
                type="text"
                value={bookkeeperEmail}
                onChange={(e) => setBookkeeperEmail(e.target.value)}
                onBlur={async () => {
                  const next = bookkeeperEmail.trim() === '' ? null : bookkeeperEmail.trim();
                  if (next === (settings?.bookkeeperEmail ?? null)) return;
                  try {
                    await updSettings.mutateAsync({ bookkeeperEmail: next });
                    toast.success('Bookkeeper emails updated');
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Could not save — check every address is a valid email');
                  }
                }}
                placeholder="books@firm.com, assistant@firm.com"
                className="max-w-md"
              />
            </Field>
          </div>
          </div>
        </Card>
      </Section>

      <Section
        title="Periods"
        action={
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-gray-400 italic">
              Generated automatically from the schedule above.
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  const r = await recalc.mutateAsync();
                  const parts = [];
                  if (r.merged) parts.push(`${r.merged} overlapping merged`);
                  if (r.deleted) parts.push(`${r.deleted} stale removed`);
                  parts.push(`${r.inserted} generated`);
                  if (r.preserved) parts.push(`${r.preserved} preserved`);
                  toast.success(`Recalculated · ${parts.join(' · ')}`);
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : 'Recalculate failed');
                }
              }}
              disabled={recalc.isPending}
              title="Force-rebuild upcoming periods to match the schedule above. Periods with logged time stay; empty + future-dated ones get cleaned up."
            >
              Recalculate pay periods
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
  const disconnectDrive = useDisconnectDrive();
  const sync = useSyncDrive();
  const unlink = useUnlinkDriveFolder();
  const { data: driveStatus } = useDriveStatus();
  const reconcile = useReconcileDriveFolders();
  const [linkOpen, setLinkOpen] = useState(false);
  const [reconcileReport, setReconcileReport] = useState<DriveReconciliationReport | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const byKind = (k: string) => integrations.find((i) => i.kind === k);
  const drive = byKind('drive');
  const driveConnected = !!driveStatus?.connected;

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
            const isDrive = kind === 'drive';
            const connected = isDrive ? driveConnected : !!i?.connected;
            const accountLabel = isDrive
              ? (driveStatus?.account ?? (connected ? 'connected' : 'not connected'))
              : (i?.account ?? (connected ? 'connected' : 'not connected'));
            const lastSyncLabel = isDrive ? i?.lastSyncAt : i?.lastSyncAt;
            return (
              <Tile key={kind}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-bold text-gray-900 capitalize">{kind === 'drive' ? 'Google Drive' : kind}</div>
                    <div className="text-[12px] text-gray-500">{accountLabel}</div>
                    {lastSyncLabel && <div className="text-[11px] text-gray-400 mt-1">Last sync {new Date(lastSyncLabel).toLocaleString()}</div>}
                  </div>
                  {connected ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        run(
                          () => (isDrive ? disconnectDrive.mutateAsync() : disconnect.mutateAsync(kind)),
                          `${kind} disconnected`,
                        )
                      }
                    >
                      Disconnect
                    </Button>
                  ) : (
                    isDrive ? (
                      <Button variant="primary" size="sm" onClick={() => window.location.assign(driveConnectUrl())}>
                        Connect
                      </Button>
                    ) : (
                      <Button variant="primary" size="sm" onClick={() => run(() => connect.mutateAsync({ kind, input: {} }), `${kind} connected`)}>
                        Connect
                      </Button>
                    )
                  )}
                </div>
              </Tile>
            );
          })}
        </div>
      </Section>

      {driveConnected && (
        <Section
          title="Drive folders"
          action={
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                disabled={reconcile.isPending}
                onClick={async () => {
                  try {
                    const r = await reconcile.mutateAsync();
                    setReconcileReport(r);
                    setReportOpen(true);
                    const parts: string[] = [];
                    if (r.linked.length) parts.push(`${r.linked.length} linked`);
                    if (r.duplicatesDetected.length) parts.push(`${r.duplicatesDetected.length} duplicates flagged`);
                    if (r.clearedMissing.length) parts.push(`${r.clearedMissing.length} missing cleared`);
                    if (r.unlinkedFolders.length + r.unlinkedProjectFolders.length > 0) {
                      parts.push(`${r.unlinkedFolders.length + r.unlinkedProjectFolders.length} orphans`);
                    }
                    toast.success(`Reconcile · ${parts.length ? parts.join(' · ') : 'nothing to fix'}`);
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Reconcile failed');
                  }
                }}
                title="Walk every client/project against Drive — clear dangling pointers, link rows to same-named folders, flag duplicates + orphans."
              >
                Reconcile
              </Button>
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
          {reconcileReport && (
            <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <button
                type="button"
                onClick={() => setReportOpen((v) => !v)}
                className="flex items-center gap-2 text-[12px] uppercase tracking-widest font-bold text-gray-500 hover:text-gray-700"
                aria-expanded={reportOpen}
              >
                <span className={`inline-block transition-transform ${reportOpen ? 'rotate-90' : ''}`}>▸</span>
                Last reconcile report ·
                {' '}
                {reconcileReport.linked.length} linked ·
                {' '}
                {reconcileReport.duplicatesDetected.length} dup ·
                {' '}
                {reconcileReport.clearedMissing.length} cleared ·
                {' '}
                {reconcileReport.unlinkedFolders.length + reconcileReport.unlinkedProjectFolders.length} orphans
              </button>
              {reportOpen && <ReconcileReportDetails report={reconcileReport} />}
            </div>
          )}
        </Section>
      )}

      <ActiveQrUploadLinksPanel />

      <GmailIntegrationPanel />

      <LinkFolderModal open={linkOpen} onClose={() => setLinkOpen(false)} />
    </>
  );
}

function ActiveQrUploadLinksPanel() {
  const toast = useToast();
  const { can } = useAuth();
  const canManageIntegrations = can('integrations.manage');
  const { data: sessions = [], isLoading } = useActiveQrUploadSessions(canManageIntegrations);
  const revoke = useRevokeQrUploadSession();
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<'all' | 'space_client' | 'space_project' | 'drive_folder' | 'todo' | 'goal'>('all');
  const [creatorFilter, setCreatorFilter] = useState<'all' | string>('all');
  const [expiringSoonOnly, setExpiringSoonOnly] = useState(false);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);

  if (!canManageIntegrations) {
    return null;
  }

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy link');
    }
  };

  const fmtTarget = (kind: string, id: string) => {
    if (kind === 'space_client') return `Client space · ${id.slice(0, 8)}…`;
    if (kind === 'space_project') return `Project space · ${id.slice(0, 8)}…`;
    if (kind === 'drive_folder') return `Drive folder · ${id.slice(0, 8)}…`;
    if (kind === 'todo') return `To-do · ${id.slice(0, 8)}…`;
    if (kind === 'goal') return `Goal · ${id.slice(0, 8)}…`;
    return `${kind} · ${id.slice(0, 8)}…`;
  };

  const creatorOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sessions) {
      m.set(s.createdByUserId, s.createdByName ?? s.createdByEmail ?? 'Unknown');
    }
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [sessions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const soonCutoff = Date.now() + 24 * 60 * 60 * 1000;
    return sessions.filter((s) => {
      if (kindFilter !== 'all' && s.targetKind !== kindFilter) return false;
      if (creatorFilter !== 'all' && s.createdByUserId !== creatorFilter) return false;
      if (expiringSoonOnly && new Date(s.expiresAt).getTime() > soonCutoff) return false;
      if (!q) return true;
      const haystack = [
        s.label,
        s.targetKind,
        s.targetId,
        s.createdByName ?? '',
        s.createdByEmail ?? '',
        s.token,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [sessions, query, kindFilter, creatorFilter, expiringSoonOnly]);

  const fmtSize = (sizeBytes: number) => {
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return '0 B';
    if (sizeBytes < 1024) return `${sizeBytes} B`;
    const kb = sizeBytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
  };

  const fmtDestination = (kind: string, id: string) => {
    if (kind === 'space_client') return `Client space · ${id}`;
    if (kind === 'space_project') return `Project space · ${id}`;
    if (kind === 'drive_folder') return `Drive folder · ${id}`;
    if (kind === 'todo') return `To-do · ${id}`;
    if (kind === 'goal') return `Goal · ${id}`;
    return `${kind} · ${id}`;
  };

  const UploadAuditDetails = ({ sessionId }: { sessionId: string }) => {
    const { data: files = [], isLoading: loadingFiles } = useQrUploadSessionFiles(sessionId, true);
    return (
      <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
        {loadingFiles ? (
          <div className="text-xs text-gray-500">Loading uploaded files…</div>
        ) : files.length === 0 ? (
          <div className="text-xs text-gray-500">No successful uploads recorded yet.</div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {files.map((f) => (
              <li key={f.id} className="py-2 first:pt-0 last:pb-0">
                <div className="text-sm text-gray-900 font-medium break-all">{f.originalName}</div>
                {(f.uploadTitle || f.uploadNotes) && (
                  <div className="mt-1 rounded-md border border-gray-200 bg-white px-2 py-1 text-[11px] text-gray-600 space-y-0.5">
                    {f.uploadTitle && <div><span className="font-semibold text-gray-700">Title:</span> {f.uploadTitle}</div>}
                    {f.uploadNotes && <div><span className="font-semibold text-gray-700">Notes:</span> {f.uploadNotes}</div>}
                  </div>
                )}
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {fmtSize(f.sizeBytes)} · {f.mimeType ?? 'unknown type'} · Uploaded {new Date(f.createdAt).toLocaleString()}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5 break-all">
                  Destination: {fmtDestination(f.destinationKind, f.destinationId)}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5 break-all">
                  Stored ID: {f.storedFileId ?? 'n/a'}
                </div>
                {f.storedFileUrl && (
                  <a
                    href={f.storedFileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex mt-1 text-[11px] font-semibold text-brand-700 hover:underline"
                  >
                    Open file
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  };

  return (
    <Section title="Mobile upload QR links">
      <Card>
        {isLoading ? (
          <div className="px-5 py-4 text-sm text-gray-500">Loading active links…</div>
        ) : sessions.length === 0 ? (
          <div className="px-5 py-4 text-sm text-gray-500">No active QR upload links.</div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-gray-100 grid grid-cols-1 md:grid-cols-4 gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search label, token, target…"
              />
              <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)}>
                <option value="all">All targets</option>
                <option value="space_client">Client space</option>
                <option value="space_project">Project space</option>
                <option value="drive_folder">Drive folder</option>
                <option value="todo">To-do</option>
                <option value="goal">Goal</option>
              </Select>
              <Select value={creatorFilter} onChange={(e) => setCreatorFilter(e.target.value)}>
                <option value="all">All creators</option>
                {creatorOptions.map(([id, label]) => (
                  <option key={id} value={id}>{label}</option>
                ))}
              </Select>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 px-2">
                <input
                  type="checkbox"
                  checked={expiringSoonOnly}
                  onChange={(e) => setExpiringSoonOnly(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Expiring in 24h
              </label>
            </div>

            {filtered.length === 0 ? (
              <div className="px-5 py-4 text-sm text-gray-500">No links match the current filters.</div>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filtered.map((s) => (
                  <li key={s.id} className="px-5 py-3">
                    <div className="flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                          <Link2 className="w-4 h-4 text-gray-400" />
                          <span className="truncate">{s.label}</span>
                        </div>
                        <div className="text-[12px] text-gray-500 mt-0.5">
                          {fmtTarget(s.targetKind, s.targetId)} · Created by {s.createdByName ?? s.createdByEmail ?? 'Unknown'}
                        </div>
                        <div className="text-[11px] text-gray-400 mt-1">
                          Expires {new Date(s.expiresAt).toLocaleString()} · Uploaded {s.uploadedCount}
                          {s.lastUploadedAt ? ` · Last upload ${new Date(s.lastUploadedAt).toLocaleString()}` : ''}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => setExpandedSessionId((prev) => (prev === s.id ? null : s.id))}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-800"
                          title="Review uploaded files"
                        >
                          {expandedSessionId === s.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void copy(s.uploadUrl)}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-800"
                          title="Copy link"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <a
                          href={s.uploadUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-800"
                          title="Open public upload page"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await revoke.mutateAsync(s.id);
                              toast.success('QR link revoked');
                            } catch (e) {
                              toast.error(e instanceof Error ? e.message : 'Could not revoke link');
                            }
                          }}
                          className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-600"
                          title="Revoke"
                          disabled={revoke.isPending}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {expandedSessionId === s.id && <UploadAuditDetails sessionId={s.id} />}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Card>
    </Section>
  );
}

/**
 * Per-section breakdown of a Drive reconcile run. Renders four small
 * lists — anything the admin needs to actually act on (orphans to
 * trash, duplicates to manually merge) gets a folder-ID badge so they
 * can search in Google Drive's URL bar.
 */
function ReconcileReportDetails({ report }: { report: DriveReconciliationReport }) {
  const Row = ({ children }: { children: React.ReactNode }) => (
    <li className="text-[12px] text-gray-700 py-0.5 break-all">{children}</li>
  );
  const Id = ({ id }: { id: string }) => (
    <span className="font-mono text-[11px] text-gray-500">{id.slice(0, 12)}…</span>
  );
  const SubHeader = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[11px] uppercase tracking-widest font-bold text-gray-500 mt-3 mb-1">{children}</div>
  );
  const anything =
    report.linked.length +
    report.duplicatesDetected.length +
    report.clearedMissing.length +
    report.unlinkedFolders.length +
    report.unlinkedProjectFolders.length;
  return (
    <div className="mt-3 space-y-1">
      {anything === 0 && (
        <div className="text-[12px] text-gray-500 italic">Drive folders are in sync — nothing to fix.</div>
      )}
      {report.linked.length > 0 && (
        <>
          <SubHeader>Linked</SubHeader>
          <ul>
            {report.linked.map((r) => (
              <Row key={`l-${r.scope}-${r.id}`}>
                {r.scope === 'client' ? 'Client' : 'Project'} <strong>{r.name}</strong> → <Id id={r.folderId} />
              </Row>
            ))}
          </ul>
        </>
      )}
      {report.duplicatesDetected.length > 0 && (
        <>
          <SubHeader>Duplicates flagged · manual cleanup in Drive</SubHeader>
          <ul>
            {report.duplicatesDetected.map((r) => (
              <Row key={`d-${r.scope}-${r.id}`}>
                <strong>{r.name}</strong> kept <Id id={r.canonicalFolderId} />; duplicates:{' '}
                {r.duplicateFolderIds.map((id) => <Id key={id} id={id} />).reduce(
                  (acc, el, i) => acc.length ? [...acc, ', ', el] : [el],
                  [] as React.ReactNode[],
                )}
              </Row>
            ))}
          </ul>
        </>
      )}
      {report.clearedMissing.length > 0 && (
        <>
          <SubHeader>Missing folders cleared</SubHeader>
          <ul>
            {report.clearedMissing.map((r) => (
              <Row key={`c-${r.scope}-${r.id}`}>
                {r.scope === 'client' ? 'Client' : 'Project'} <strong>{r.name}</strong> · was <Id id={r.staleFolderId} />
              </Row>
            ))}
          </ul>
        </>
      )}
      {report.unlinkedFolders.length > 0 && (
        <>
          <SubHeader>Orphan client folders · not pointed to by any client</SubHeader>
          <ul>
            {report.unlinkedFolders.map((r) => (
              <Row key={`u-${r.folderId}`}>
                <strong>{r.name}</strong> · <Id id={r.folderId} />
              </Row>
            ))}
          </ul>
        </>
      )}
      {report.unlinkedProjectFolders.length > 0 && (
        <>
          <SubHeader>Orphan project folders · inside client folders but not linked</SubHeader>
          <ul>
            {report.unlinkedProjectFolders.map((r) => (
              <Row key={`up-${r.folderId}`}>
                <strong>{r.name}</strong> in <em>{r.clientName}</em> · <Id id={r.folderId} />
              </Row>
            ))}
          </ul>
        </>
      )}
    </div>
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
