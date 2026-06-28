'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { API_URL } from '@/lib/env';
import { qk } from '@/lib/queryKeys';
import type {
  CreateClientInput,
  UpdateClientInput,
  CreateProjectInput,
  UpdateProjectInput,
  CreateGoalInput,
  UpdateGoalInput,
  MoveGoalInput,
  AddResourceInput,
  CreateEpicInput,
  UpdateEpicInput,
  CreateMilestoneInput,
  UpdateMilestoneInput,
  CreateTodoInput,
  UpdateTodoInput,
  StartTimerInput,
  ManualEntryInput,
  PayConfigInput,
  GeneratePeriodsInput,
  ConnectIntegrationInput,
  LinkFolderInput,
  InviteUserInput,
  UpdateUserInput,
  ActivityPayload,
  TimerPayload,
  CreateGroupInput,
  UpdateGroupInput,
  Permission,
  AuthConfig,
  AuthMethods,
  AppSettings,
  UpdateAppSettingsInput,
  SpaceBlock,
  SpaceFile,
  ClientOverview,
  ProjectOverview,
} from '@allebrum/shared';

// ---- Types (matching API row shapes; permissive to avoid double-maintaining schema) ----
export type UserRow = {
  id: string;
  name: string;
  email: string;
  initials: string;
  color: string;
  billable: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};
export type ClientRow = {
  id: string;
  name: string;
  kind: string;
  color: string;
  /** Drive folder id for this client (lazy-created when Drive is connected). */
  driveFolderId: string | null;
  // Client/Project Spaces: Notes-canvas blocks and Files-tab attachments.
  // Always arrays — server defaults to [] on insert; never null.
  spaceBlocks: SpaceBlock[];
  spaceFiles: SpaceFile[];
  clientOverview: ClientOverview;
  /** F23 client portal — staff-set URL-safe slug. Null = no portal yet. */
  portalSlug: string | null;
  /** ISO timestamp string; null = unpublished (slug exists but lookup 404s). */
  portalPublishedAt: string | null;
};
export type ClientContactRow = {
  id: string;
  clientId: string;
  name: string;
  email: string;
  role: 'primary' | 'viewer';
  invitedAt: string;
  acceptedAt: string | null;
  lastActiveAt: string | null;
  createdAt: string;
};
export type ProjectStatusRow = { id: string; label: string; tone: string };
export type ProjectRow = {
  id: string;
  clientId: string;
  name: string;
  code: string;
  opportunityStatus: 'pipeline' | 'won' | 'lost' | 'on-hold';
  opportunityValue: number | null;
  timeSpentMin: number;
  projectOverview: ProjectOverview;
  billable: boolean;
  budgetHrs: number;
  color: string;
  /** Drive folder id for this project (sub-folder under its client). */
  driveFolderId: string | null;
  statuses: ProjectStatusRow[] | null;
  spaceBlocks: SpaceBlock[];
  spaceFiles: SpaceFile[];
};
export type GoalResourceRow = {
  id: string;
  goalId: string;
  kind: string;
  title: string;
  url: string;
  meta: string;
  // Populated for resources that were uploaded into the portal (the file
  // was pushed to Drive). Null for legacy URL-bookmark resources.
  driveFileId: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  addedBy: string | null;
  addedAt: string;
};
export type ChecklistItemRow = { id: string; text: string; done: boolean };
export type GoalHealth = 'on-track' | 'at-risk' | 'off-track' | 'done';
export type GoalRow = {
  id: string;
  // Both null = a WORKSPACE-level goal (not tied to client delivery).
  clientId: string | null;
  projectId: string | null;
  title: string;
  description: string | null;
  // Free-form: default workflow value OR a project custom-workflow status id.
  status: string;
  ownerId: string | null;
  // F25: a goal may be owned by a group instead of a user. Either side
  // can be null; both null = unowned. Server CHECK enforces XOR.
  ownerGroupId: string | null;
  startDate: string | null;
  endDate: string | null;
  priority: 'low' | 'medium' | 'high';
  tag: string;
  checklist: ChecklistItemRow[];
  resources: GoalResourceRow[];
  // PM workspace fields
  epicId: string | null;
  health: GoalHealth | null;
  progress: number | null;
  dependsOn: string[] | null;
  // 0029: visible in the client-facing portal.
  sharedWithClient: boolean;
};
export type EpicRow = {
  id: string;
  projectId: string;
  clientId: string;
  title: string;
  color: string;
  icon: string;
  startDate: string | null;
  endDate: string | null;
};
export type MilestoneRow = {
  id: string;
  projectId: string;
  title: string;
  date: string;
  kind: 'release' | 'review' | 'deadline' | 'phase';
  color: string;
  // S3.2 client sign-off — null until a portal contact approves it.
  signedOffAt: string | null;
  signedOffByContactId: string | null;
  signOffComment: string | null;
};
export type TodoRow = {
  id: string;
  title: string;
  description: string | null;
  assigneeId: string | null;
  // F25: a todo may be assigned to a group instead of a user. Either side
  // can be null; both null = unassigned. Server CHECK enforces XOR.
  assigneeGroupId: string | null;
  clientId: string | null;
  projectId: string | null;
  goalId: string | null;
  status: 'open' | 'done';
  dueDate: string | null;
  estimateMin: number;
  loggedMin: number;
  priority: 'low' | 'medium' | 'high';
  tags: string[];
  private: boolean;
  // 0029: visible in the client portal's project view.
  sharedWithClient: boolean;
  checklist: ChecklistItemRow[];
  // F25: file attachments on the todo itself. Always an array; server
  // defaults to [].
  attachments: SpaceFile[];
};
export type EntryRow = {
  id: string;
  userId: string;
  // Nullable: an entry may have no project when the user tracked time
  // against a project-less to-do. Renderers should fall back to "—".
  projectId: string | null;
  note: string;
  startIso: string;
  endIso: string | null;
  durationMin: number;
  payPeriodId: string | null;
  status: 'draft' | 'submitted' | 'approved' | 'rejected';
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  rejectionNote: string | null;
  todoId: string | null;
};
export type PayPeriodRow = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  approvalCutoff: string;
  payDate: string;
  status: 'open' | 'review' | 'closed';
  closedAt: string | null;
};
export type PayConfigRow = {
  id: string;
  cadence: 'by-date' | 'weekly' | 'bi-weekly';
  payDates: (number | 'last')[];
  weekendRule: 'prior' | 'after' | 'as-is';
  anchor: string | null;
  processingBufferDays: number;
  autoClose: boolean;
  approverId: string | null;
  timezone: string;
  remindEmployees: boolean;
  remindApprovers: boolean;
};
export type IntegrationRow = {
  kind: string;
  connected: boolean;
  account: string | null;
  connectedAt: string | null;
  lastSyncAt: string | null;
  autoSync: boolean;
  syncIntervalHours: number;
  config: Record<string, unknown>;
};
export type DriveFolderRow = {
  id: string;
  drivePath: string;
  clientId: string;
  itemCount: number;
  lastSync: string;
};
export type DriveItemRow = {
  id: string;
  folderId: string;
  kind: string;
  title: string;
  path: string;
  meta: string;
  modified: string | null;
};

export type GroupRow = {
  id: string;
  name: string;
  description: string;
  isSystem: boolean;
  require2fa: boolean;
  permissions: string[];
};
export type PermissionRow = { key: string; label: string; category: string };

// ---- Bootstrap ----
/** SaaS billing surface — null on self-host / billing-exempt workspaces. */
export type BillingInfo = {
  status: string | null; // 'trialing' | 'active' | 'past_due' | 'canceled' | null
  trialEndsAt: string | null;
  hasPaymentMethod: boolean;
};
export type BootstrapData = {
  me: (UserRow & { permissions: Permission[]; groupIds: string[] }) | null;
  users: UserRow[];
  clients: ClientRow[];
  projects: ProjectRow[];
  goals: GoalRow[];
  todos: TodoRow[];
  entries: EntryRow[];
  timers: TimerPayload[];
  payPeriods: PayPeriodRow[];
  payConfig: PayConfigRow;
  integrations: IntegrationRow[];
  driveFolders: DriveFolderRow[];
  driveItems: DriveItemRow[];
  activity: ActivityPayload[];
  billing: BillingInfo | null;
};

/** Billing info straight from the cached bootstrap payload (no extra fetch). */
export function useBillingInfo(): BillingInfo | null {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.bootstrap,
    enabled: false, // bootstrap is fetched by the shell; just read the cache
    queryFn: () => api.get<BootstrapData>('/bootstrap'),
  }).data?.billing ?? null;
}

export function useBootstrap() {
  const qc = useQueryClient();
  return useQuery({
    queryKey: qk.bootstrap,
    queryFn: async () => {
      const data = await api.get<BootstrapData>('/bootstrap');
      qc.setQueryData(qk.users, data.users);
      qc.setQueryData(qk.clients, data.clients);
      qc.setQueryData(qk.projects, data.projects);
      qc.setQueryData(qk.goals, data.goals);
      qc.setQueryData(qk.todos, data.todos);
      qc.setQueryData(qk.entries(), data.entries);
      qc.setQueryData(qk.timers, data.timers);
      qc.setQueryData(qk.payPeriods, data.payPeriods);
      qc.setQueryData(qk.payConfig, data.payConfig);
      qc.setQueryData(qk.integrations, data.integrations);
      qc.setQueryData(qk.driveFolders, data.driveFolders);
      qc.setQueryData(qk.driveItems(), data.driveItems);
      qc.setQueryData(qk.activity, data.activity);
      return data;
    },
  });
}

// ---- Users ----
export function useUsers() {
  return useQuery({ queryKey: qk.users, queryFn: () => api.get<UserRow[]>('/users') });
}
export function useInviteUser() {
  const qc = useQueryClient();
  return useMutation({
    // `reused: true` means an existing teammate (from another workspace) was
    // added here rather than a brand-new account being created + emailed.
    mutationFn: (input: InviteUserInput) => api.post<UserRow & { reused: boolean }>('/users', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.users }),
  });
}
export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateUserInput }) => api.patch<UserRow>(`/users/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.users }),
  });
}
export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/users/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.users }),
  });
}

// ---- Clients / Projects ----
export function useClients() {
  return useQuery({ queryKey: qk.clients, queryFn: () => api.get<ClientRow[]>('/clients') });
}
export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateClientInput) => api.post<ClientRow>('/clients', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.clients }),
  });
}
export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateClientInput }) =>
      api.patch<ClientRow>(`/clients/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.clients }),
  });
}

// ---- F23 client portal contacts (staff side) -------------------------
export function useClientContacts(clientId: string | null) {
  return useQuery({
    queryKey: ['clientContacts', clientId ?? ''],
    queryFn: () => api.get<ClientContactRow[]>(`/clients/${clientId}/contacts`),
    enabled: !!clientId,
  });
}
export function useInviteClientContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, input }: { clientId: string; input: { name: string; email: string; role?: 'primary' | 'viewer' } }) =>
      api.post<ClientContactRow>(`/clients/${clientId}/contacts`, input),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ['clientContacts', vars.clientId] }),
  });
}
export function useUpdateClientContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, contactId, patch }: { clientId: string; contactId: string; patch: { name?: string; role?: 'primary' | 'viewer' } }) =>
      api.patch<ClientContactRow>(`/clients/${clientId}/contacts/${contactId}`, patch),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ['clientContacts', vars.clientId] }),
  });
}
export function useResendClientInvite() {
  return useMutation({
    mutationFn: ({ clientId, contactId }: { clientId: string; contactId: string }) =>
      api.post<{ ok: true }>(`/clients/${clientId}/contacts/${contactId}/resend`),
  });
}
export function useRemoveClientContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ clientId, contactId }: { clientId: string; contactId: string }) =>
      api.del<{ ok: true }>(`/clients/${clientId}/contacts/${contactId}`),
    onSuccess: (_data, vars) =>
      qc.invalidateQueries({ queryKey: ['clientContacts', vars.clientId] }),
  });
}

export function useProjects() {
  return useQuery({ queryKey: qk.projects, queryFn: () => api.get<ProjectRow[]>('/projects') });
}
export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) => api.post<ProjectRow>('/projects', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
  });
}
export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateProjectInput }) =>
      api.patch<ProjectRow>(`/projects/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
  });
}

// ---- Goals ----
export function useGoals() {
  return useQuery({ queryKey: qk.goals, queryFn: () => api.get<GoalRow[]>('/goals') });
}
export function useEpics() {
  return useQuery({ queryKey: qk.epics, queryFn: () => api.get<EpicRow[]>('/epics') });
}
export function useCreateEpic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEpicInput) => api.post<EpicRow>('/epics', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.epics }),
  });
}
export function useUpdateEpic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateEpicInput }) => api.patch<EpicRow>(`/epics/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.epics }),
  });
}
export function useDeleteEpic() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/epics/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.epics });
      qc.invalidateQueries({ queryKey: qk.goals });
    },
  });
}
export function useMilestones() {
  return useQuery({ queryKey: qk.milestones, queryFn: () => api.get<MilestoneRow[]>('/milestones') });
}
export function useCreateMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMilestoneInput) => api.post<MilestoneRow>('/milestones', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.milestones }),
  });
}
export function useUpdateMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateMilestoneInput }) => api.patch<MilestoneRow>(`/milestones/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.milestones }),
  });
}
export function useDeleteMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/milestones/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.milestones }),
  });
}
export function useCreateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGoalInput) => api.post<GoalRow>('/goals', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.goals }),
  });
}
export function useUpdateGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateGoalInput }) => api.patch<GoalRow>(`/goals/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.goals }),
  });
}
export function useMoveGoal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string } & MoveGoalInput) => api.patch<GoalRow>(`/goals/${id}/status`, { status }),
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: qk.goals });
      const prev = qc.getQueryData<GoalRow[]>(qk.goals);
      if (prev) {
        qc.setQueryData(
          qk.goals,
          prev.map((g) => (g.id === id ? { ...g, status } : g)),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.goals, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.goals }),
  });
}
export function useAddResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, input }: { goalId: string; input: AddResourceInput }) =>
      api.post<GoalResourceRow>(`/goals/${goalId}/resources`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.goals }),
  });
}
export function useRemoveResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, resourceId }: { goalId: string; resourceId: string }) =>
      api.del<{ ok: true }>(`/goals/${goalId}/resources/${resourceId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.goals }),
  });
}
export function useRenameGoalResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, resourceId, title }: { goalId: string; resourceId: string; title: string }) =>
      api.patch<GoalResourceRow>(`/goals/${goalId}/resources/${resourceId}`, { title }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.goals });
      qc.invalidateQueries({ queryKey: qk.clients });
      qc.invalidateQueries({ queryKey: qk.projects });
      qc.invalidateQueries({ queryKey: ['driveList'] });
    },
  });
}
// Multipart upload: pushes a real file into the goal's project Drive
// folder and records the resource. Use this for drag-drop / file-picker
// flows; useAddResource() is still the right call for URL bookmarks.
export function useUploadGoalResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ goalId, file }: { goalId: string; file: File }) => {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${API_URL}/api/goals/${goalId}/resources/upload`, {
        method: 'POST',
        credentials: 'include',
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'upload_failed');
      }
      return res.json() as Promise<GoalResourceRow>;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.goals }),
  });
}

// ---- Todos ----
export function useTodos() {
  return useQuery({ queryKey: qk.todos, queryFn: () => api.get<TodoRow[]>('/todos') });
}
export function useCreateTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTodoInput) => api.post<TodoRow>('/todos', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.todos }),
  });
}
export function useUpdateTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTodoInput }) => api.patch<TodoRow>(`/todos/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.todos }),
  });
}
export function useToggleTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<TodoRow>(`/todos/${id}/toggle`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.todos });
      const prev = qc.getQueryData<TodoRow[]>(qk.todos);
      if (prev) {
        qc.setQueryData(
          qk.todos,
          prev.map((t) =>
            t.id === id ? { ...t, status: t.status === 'done' ? 'open' : 'done' } : t,
          ),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.todos, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.todos }),
  });
}
export function useDeleteTodo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/todos/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.todos }),
  });
}

// ---- Entries / Timer ----
export function useEntries() {
  return useQuery({ queryKey: qk.entries(), queryFn: () => api.get<EntryRow[]>('/entries') });
}
export function useActiveTimers() {
  return useQuery({ queryKey: qk.timers, queryFn: () => api.get<TimerPayload[]>('/entries/timers') });
}
export function useStartTimer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: StartTimerInput) => api.post('/entries/timer/start', input),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.timers }),
  });
}
export function useStopTimer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/entries/timer/stop'),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: qk.timers });
      qc.invalidateQueries({ queryKey: ['entries'] });
    },
  });
}
export function useAddManualEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ManualEntryInput) => api.post<EntryRow>('/entries', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['entries'] }),
  });
}
export function useUpdateEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ManualEntryInput> }) =>
      api.patch<EntryRow>(`/entries/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['entries'] }),
  });
}
export function useDeleteEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/entries/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['entries'] }),
  });
}
export function useSubmitEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.post<{ count: number }>('/entries/submit', { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['entries'] }),
  });
}
export function useApproveEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.post<{ count: number }>('/entries/approve', { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['entries'] }),
  });
}
export function useRejectEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, note }: { ids: string[]; note: string }) =>
      api.post<{ count: number }>('/entries/reject', { ids, note }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['entries'] }),
  });
}
export function useReopenEntries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => api.post<{ count: number }>('/entries/reopen', { ids }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['entries'] }),
  });
}

// ---- Pay periods + config ----
export function usePayPeriods() {
  return useQuery({ queryKey: qk.payPeriods, queryFn: () => api.get<PayPeriodRow[]>('/pay-periods') });
}
export function usePayConfig() {
  return useQuery({ queryKey: qk.payConfig, queryFn: () => api.get<PayConfigRow>('/pay-config') });
}
export function useUpdatePayConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<PayConfigInput>) => api.patch<PayConfigRow>('/pay-config', patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.payConfig }),
  });
}
export function useGeneratePeriods() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: GeneratePeriodsInput) => api.post<{ inserted: number }>('/pay-periods/generate', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.payPeriods }),
  });
}
export function useClosePeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ autoApproved: number }>(`/pay-periods/${id}/close`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.payPeriods });
      qc.invalidateQueries({ queryKey: ['entries'] });
    },
  });
}
export function useReopenPeriod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/pay-periods/${id}/reopen`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.payPeriods }),
  });
}
export function useMovePeriodToReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`/pay-periods/${id}/review`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.payPeriods }),
  });
}
export function useSendBookkeeperReport() {
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: true; sentTo: string; rows: number }>(`/pay-periods/${id}/send-bookkeeper`),
  });
}
export function useRecalculatePayPeriods() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ deleted: number; inserted: number; preserved: number; merged: number }>(
        '/pay-periods/recalculate',
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.payPeriods }),
  });
}

// ---- Integrations + Drive ----
export function useIntegrations() {
  return useQuery({ queryKey: qk.integrations, queryFn: () => api.get<IntegrationRow[]>('/integrations') });
}
export function useConnectIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, input }: { kind: string; input: ConnectIntegrationInput }) =>
      api.post<IntegrationRow>(`/integrations/${kind}/connect`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.integrations }),
  });
}
export function useDisconnectIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: string) => api.post<IntegrationRow>(`/integrations/${kind}/disconnect`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.integrations }),
  });
}
export function useUpdateIntegration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, patch }: { kind: string; patch: ConnectIntegrationInput }) =>
      api.patch<IntegrationRow>(`/integrations/${kind}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.integrations }),
  });
}
export function useSyncDrive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<IntegrationRow>('/integrations/drive/sync'),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.integrations }),
  });
}
export function useDriveFolders() {
  return useQuery({ queryKey: qk.driveFolders, queryFn: () => api.get<DriveFolderRow[]>('/integrations/drive/folders') });
}
export function useDriveItems() {
  return useQuery({ queryKey: qk.driveItems(), queryFn: () => api.get<DriveItemRow[]>('/integrations/drive/items') });
}
export function useLinkDriveFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LinkFolderInput) => api.post<DriveFolderRow>('/integrations/drive/folders', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.driveFolders }),
  });
}
export function useUnlinkDriveFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/integrations/drive/folders/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.driveFolders }),
  });
}

// ---- Activity ----
export function useActivity() {
  return useQuery({ queryKey: qk.activity, queryFn: () => api.get<ActivityPayload[]>('/activity?limit=30') });
}

// ---- Auth config (public) + workspace settings ----
export function useAuthConfig() {
  return useQuery({
    queryKey: ['authConfig'] as const,
    queryFn: () => api.get<AuthConfig>('/auth/config'),
    staleTime: 60_000,
  });
}
/** Two-step login: resolve which methods THIS email's account supports (and the
 *  resolved workspace's branding). Called on the login page's "Continue". */
export function fetchAuthMethods(email: string): Promise<AuthMethods> {
  return api.post<AuthMethods>('/auth/methods', { email });
}
export function useSettings() {
  return useQuery({ queryKey: ['settings'] as const, queryFn: () => api.get<AppSettings>('/settings') });
}
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: UpdateAppSettingsInput) => api.patch<AppSettings>('/settings', patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['authConfig'] });
    },
  });
}

// ---- RBAC ----
export function usePermissionsCatalog() {
  return useQuery({
    queryKey: qk.permissionsCatalog,
    queryFn: () => api.get<PermissionRow[]>('/rbac/permissions'),
  });
}
export function useGroups() {
  return useQuery({ queryKey: qk.groups, queryFn: () => api.get<GroupRow[]>('/rbac/groups') });
}
export function useCreateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGroupInput) => api.post<GroupRow>('/rbac/groups', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.groups }),
  });
}
export function useUpdateGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateGroupInput }) =>
      api.patch<GroupRow>(`/rbac/groups/${id}`, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.groups }),
  });
}
export function useDeleteGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ ok: true }>(`/rbac/groups/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.groups }),
  });
}
export function useSetGroupPermissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, permissions }: { id: string; permissions: Permission[] }) =>
      api.put<{ ok: true }>(`/rbac/groups/${id}/permissions`, { permissions }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.groups });
      qc.invalidateQueries({ queryKey: qk.bootstrap });
    },
  });
}
export function useSetUserGroups() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, groupIds }: { id: string; groupIds: string[] }) =>
      api.put<{ ok: true }>(`/rbac/users/${id}/groups`, { groupIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.users });
      qc.invalidateQueries({ queryKey: qk.bootstrap });
    },
  });
}
/**
 * F25: list the user ids currently in a group. Used by the redesigned
 * GroupsTab Members section.
 */
export function useGroupMembers(groupId: string | null) {
  return useQuery({
    queryKey: ['groupMembers', groupId] as const,
    enabled: !!groupId,
    queryFn: () => api.get<string[]>(`/rbac/groups/${groupId}/members`),
  });
}
export function useAddUserToGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
      api.post<{ ok: true }>(`/rbac/groups/${groupId}/users`, { userId }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['groupMembers', v.groupId] });
      qc.invalidateQueries({ queryKey: qk.users });
      qc.invalidateQueries({ queryKey: qk.bootstrap });
    },
  });
}
export function useRemoveUserFromGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, userId }: { groupId: string; userId: string }) =>
      api.del<{ ok: true }>(`/rbac/groups/${groupId}/users/${userId}`),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['groupMembers', v.groupId] });
      qc.invalidateQueries({ queryKey: qk.users });
      qc.invalidateQueries({ queryKey: qk.bootstrap });
    },
  });
}
export function useUserOverrides(userId: string | null) {
  return useQuery({
    queryKey: ['userOverrides', userId] as const,
    enabled: !!userId,
    queryFn: () => api.get<{ permission: string; effect: 'grant' | 'deny' }[]>(`/rbac/users/${userId}/overrides`),
  });
}
export function useSetUserOverrides() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      overrides,
    }: {
      id: string;
      overrides: { permission: Permission; effect: 'grant' | 'deny' }[];
    }) => api.put<{ ok: true }>(`/rbac/users/${id}/overrides`, { overrides }),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['userOverrides', v.id] });
      qc.invalidateQueries({ queryKey: qk.bootstrap });
    },
  });
}
