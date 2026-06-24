'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, PORTAL_TOKEN_KEY } from '@/lib/api';

/**
 * F23 — hooks for the public client portal. Mirrors the shape of the
 * staff `useAuth` + `useResources` patterns but talks to /api/portal/*
 * and is keyed by `portal:slug:*` so the caches don't collide with the
 * staff app if both are open in the same tab (rare, but cheap to be
 * safe).
 */

export type PortalMe = {
  contact: { id: string; name: string; email: string; role: 'primary' | 'viewer' };
  client: { id: string; name: string; color: string; slug: string };
  /** The owning WORKSPACE's branding (the agency, not the Hoppa product) —
   *  null only for legacy rows with no tenant. */
  workspace: { name: string; color: string; logo: string | null } | null;
};

export type PortalLookup = { name: string; color: string; slug: string };

/** Public — slug → branding + client name (404 when unpublished). */
export function usePortalLookup(slug: string | null) {
  return useQuery({
    queryKey: ['portal', 'lookup', slug ?? ''],
    queryFn: () => api.get<PortalLookup>(`/portal/lookup?slug=${encodeURIComponent(slug ?? '')}`),
    enabled: !!slug,
    retry: false,
  });
}

/** Session-gated — returns null while loading or unauth, populated when signed in. */
export function usePortalMe() {
  return useQuery({
    queryKey: ['portal', 'me'],
    queryFn: async () => {
      try {
        return await api.get<PortalMe>('/portal/me');
      } catch (e) {
        // 401 from the API surfaces as a thrown error; downstream
        // treats `data === null` as "not signed in".
        if (e instanceof Error && /unauthorized|session_invalidated/.test(e.message)) {
          return null;
        }
        throw e;
      }
    },
    retry: false,
    staleTime: 5_000,
  });
}

export function useRequestPortalAccess() {
  return useMutation({
    mutationFn: ({ slug, email }: { slug: string; email: string }) =>
      api.post<{ ok: true }>(`/portal/request-access`, { slug, email }),
  });
}

export function useExchangePortalToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slug, token }: { slug: string; token: string }) =>
      api.post<{ ok: true; slug: string; token: string }>(`/portal/exchange`, { slug, token }),
    onSuccess: (res) => {
      // Persist the stateless portal-session token; lib/api.ts sends it as
      // X-Portal-Token on every subsequent portal call.
      if (typeof window !== 'undefined' && res?.token) {
        window.localStorage.setItem(PORTAL_TOKEN_KEY, res.token);
      }
      qc.invalidateQueries({ queryKey: ['portal', 'me'] });
    },
  });
}

export function useLogoutPortal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>(`/portal/logout`),
    onSuccess: () => {
      if (typeof window !== 'undefined') window.localStorage.removeItem(PORTAL_TOKEN_KEY);
      qc.setQueryData(['portal', 'me'], null);
      qc.invalidateQueries({ queryKey: ['portal'] });
    },
  });
}

// ---- Phase 2B read endpoints (light typings to be extended) ----------

export type PortalProjectRow = {
  id: string;
  name: string;
  code: string;
  color: string;
  goalCount: number;
  openTodoCount: number;
  avgProgress: number;
  // S3.1 status line: worst goal health + the next upcoming milestone.
  health: 'on-track' | 'at-risk' | 'off-track' | null;
  nextMilestone: { title: string; date: string } | null;
};
export type PortalGoalRow = {
  id: string;
  projectId: string;
  title: string;
  status: string;
  progress: number | null;
  dueDate: string | null;
};
export type PortalMilestoneRow = {
  id: string;
  projectId: string;
  title: string;
  date: string;
  kind: 'release' | 'review' | 'deadline' | 'phase';
  /** Client sign-off — null until a contact approves the milestone. */
  signOff: { at: string; by: string | null; comment: string | null } | null;
};
export type PortalFileRow = {
  id: string;
  title: string;
  url: string;
  meta?: string;
  addedAt: string;
};
export type PortalOverview = {
  client: PortalMe['client'];
  projects: PortalProjectRow[];
  inFlightGoals: PortalGoalRow[];
  upcomingMilestones: PortalMilestoneRow[];
  fileCount: number;
};

export function usePortalOverview(enabled = true) {
  return useQuery({
    queryKey: ['portal', 'overview'],
    queryFn: () => api.get<PortalOverview>('/portal/overview'),
    enabled,
    retry: false,
  });
}

export function usePortalProjects(enabled = true) {
  return useQuery({
    queryKey: ['portal', 'projects'],
    queryFn: () => api.get<PortalProjectRow[]>('/portal/projects'),
    enabled,
    retry: false,
  });
}

// ---- Project detail (0029) --------------------------------------------

export type PortalProjectTodo = {
  id: string;
  title: string;
  status: 'open' | 'done';
  dueDate: string | null;
};

export type PortalProjectDetail = {
  project: PortalProjectRow;
  /** Only items staff explicitly shared (`sharedWithClient`). */
  goals: PortalGoalRow[];
  todos: PortalProjectTodo[];
  files: PortalFileRow[];
  milestones: (PortalMilestoneRow & { date: string })[];
};

export function usePortalProject(id: string | null) {
  return useQuery({
    queryKey: ['portal', 'projects', id ?? ''],
    queryFn: () => api.get<PortalProjectDetail>(`/portal/projects/${id}`),
    enabled: !!id,
    retry: false,
  });
}

export function usePortalFiles(enabled = true) {
  return useQuery({
    queryKey: ['portal', 'files'],
    queryFn: () => api.get<PortalFileRow[]>('/portal/files'),
    enabled,
    retry: false,
  });
}

// ---- Tickets (Sprint 4) ----------------------------------------------

export type PortalTicketRow = {
  id: string;
  clientId: string;
  projectId: string | null;
  todoId: string | null;
  title: string;
  status: 'open' | 'in_progress' | 'waiting_on_client' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  messageCount: number;
  openedBy: string | null;
};

export type PortalTicketMessage = {
  id: string;
  ticketId: string;
  authorKind: 'contact' | 'staff';
  authorName: string | null;
  body: string;
  createdAt: string;
};

export type PortalTicketDetail = PortalTicketRow & {
  body: string;
  messages: PortalTicketMessage[];
};

export function usePortalTickets(enabled = true) {
  return useQuery({
    queryKey: ['portal', 'tickets'],
    queryFn: () => api.get<PortalTicketRow[]>('/portal/tickets'),
    enabled,
    retry: false,
  });
}

export function usePortalTicket(id: string | null) {
  return useQuery({
    queryKey: ['portal', 'tickets', id ?? ''],
    queryFn: () => api.get<PortalTicketDetail>(`/portal/tickets/${id}`),
    enabled: !!id,
    retry: false,
  });
}

export function useCreatePortalTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { title: string; body: string; projectId?: string }) =>
      api.post<PortalTicketDetail>('/portal/tickets', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal', 'tickets'] }),
  });
}

export function useReplyPortalTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      api.post<PortalTicketMessage>(`/portal/tickets/${id}/messages`, { body }),
    onSuccess: (_m, { id }) => {
      qc.invalidateQueries({ queryKey: ['portal', 'tickets'] });
      qc.invalidateQueries({ queryKey: ['portal', 'tickets', id] });
    },
  });
}

// ---- Connections hub (Connect feature; primary contact only) ----------

export type PortalConnection = {
  id: string;
  provider: 'composio' | 'zernio';
  integration: string;
  displayName: string | null;
  status: string;
  connectedAt: string;
};

export type PortalWorkflowRun = {
  id: string;
  kind: string;
  result: unknown;
  createdAt: string;
};

export type PortalConnectionsData = {
  connections: PortalConnection[];
  runs: PortalWorkflowRun[];
};

/** This client's connected provider accounts + recent on-behalf runs (403 for viewers). */
export function usePortalConnections(enabled = true) {
  return useQuery({
    queryKey: ['portal', 'connections'],
    queryFn: () => api.get<PortalConnectionsData>('/portal/connections'),
    enabled,
    retry: false,
  });
}

/** Start a Composio (apps & tools) connect; returns the URL to redirect to. */
export function useConnectComposio() {
  return useMutation({
    mutationFn: (toolkit: string) => api.post<{ redirectUrl: string }>('/connect/composio', { toolkit }),
  });
}

/** Start a Zernio (social channel) connect; returns the URL to redirect to. */
export function useConnectZernio() {
  return useMutation({
    mutationFn: (platform: string) => api.post<{ authUrl: string }>('/connect/zernio', { platform }),
  });
}

// ---- Workflows + Activity (Connect feature; primary contact only) ------

export type PortalActivityRun = {
  id: string;
  kind: string;
  payload: unknown;
  result: { ok?: boolean; error?: string } & Record<string, unknown>;
  createdAt: string;
};

/** The on-behalf workflow run history (403 for viewers). */
export function usePortalActivity(enabled = true) {
  return useQuery({
    queryKey: ['portal', 'activity'],
    queryFn: () => api.get<PortalActivityRun[]>('/portal/activity'),
    enabled,
    retry: false,
  });
}

type RunResult = { runId: string; ok: boolean; result: unknown };

/** Publish a post to the client's connected social accounts. */
export function useRunSocialPost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { content: string; accountIds: string[]; publishNow?: boolean }) =>
      api.post<RunResult>('/portal/workflows/social-post', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal', 'activity'] }),
  });
}

/** Run the demo Composio tool (list Gmail labels) on behalf of the client. */
export function useRunComposioTool() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<RunResult>('/portal/workflows/composio-tool', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal', 'activity'] }),
  });
}

/** S3.2: approve a milestone (optional comment). 409 = already signed. */
export function useSignOffMilestone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comment }: { id: string; comment?: string }) =>
      api.post<{ ok: true; signOff: PortalMilestoneRow['signOff'] }>(
        `/portal/milestones/${id}/sign-off`,
        comment?.trim() ? { comment: comment.trim() } : {},
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal', 'overview'] }),
  });
}
