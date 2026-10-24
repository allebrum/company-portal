'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  useClients,
  useProjects,
  useUpdateClient,
  useUpdateProject,
  type ClientRow,
  type ProjectRow,
} from '@/hooks/useResources';
import type { SpaceBlock, SpaceFile } from '@allebrum/shared';
import type { Scope } from '@/lib/roadmap';
import { api } from '@/lib/api';

/**
 * Resolves a Space scope to the underlying ClientRow / ProjectRow plus the
 * canonical `clientId` (always present once resolved). Returns nullish
 * fields while the underlying queries are still loading.
 *
 * Centralizes the "scope = client OR project" plumbing so individual tabs
 * don't reach into both query caches with the same boilerplate.
 */
export function useSpaceData(scope: Scope | null): {
  client: ClientRow | null;
  project: ProjectRow | null;
  clientId: string | null;
  projectId: string | null;
  spaceBlocks: SpaceBlock[];
  spaceFiles: SpaceFile[];
  loading: boolean;
} {
  const { data: clients = [], isLoading: clientsLoading } = useClients();
  const { data: projects = [], isLoading: projectsLoading } = useProjects();

  return useMemo(() => {
    if (!scope || scope.kind === 'all') {
      return {
        client: null,
        project: null,
        clientId: null,
        projectId: null,
        spaceBlocks: [],
        spaceFiles: [],
        loading: clientsLoading || projectsLoading,
      };
    }
    if (scope.kind === 'project') {
      const project = projects.find((p) => p.id === scope.id) ?? null;
      const client = project ? (clients.find((c) => c.id === project.clientId) ?? null) : null;
      return {
        client,
        project,
        clientId: project?.clientId ?? null,
        projectId: project?.id ?? null,
        spaceBlocks: project?.spaceBlocks ?? [],
        spaceFiles: project?.spaceFiles ?? [],
        loading: clientsLoading || projectsLoading,
      };
    }
    // scope.kind === 'client'
    const client = clients.find((c) => c.id === scope.id) ?? null;
    return {
      client,
      project: null,
      clientId: client?.id ?? null,
      projectId: null,
      spaceBlocks: client?.spaceBlocks ?? [],
      spaceFiles: client?.spaceFiles ?? [],
      loading: clientsLoading || projectsLoading,
    };
  }, [scope, clients, projects, clientsLoading, projectsLoading]);
}

/**
 * Debounced full-replace writer for the active Space's `spaceBlocks` JSONB
 * column. The Notes canvas reducer maintains live local state and calls
 * `save(nextBlocks)` after every dispatch; we coalesce bursts of edits
 * into a single PATCH every 250ms.
 *
 * Files-tab writes don't use this — those are discrete user actions
 * (upload, paste link, remove) and warrant immediate writes via
 * useUpdateSpaceFiles.
 */
export function useUpdateSpaceBlocks(scope: Scope | null) {
  const updateClient = useUpdateClient();
  const updateProject = useUpdateProject();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The pending payload remembers which scope it belongs to, so a flush
  // after a client→project hop still writes to the right row.
  const pending = useRef<{ scope: Scope; blocks: SpaceBlock[] } | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const mutators = useRef({ updateClient, updateProject });
  mutators.current = { updateClient, updateProject };

  const send = useCallback((opts: { keepalive?: boolean } = {}) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const p = pending.current;
    pending.current = null;
    if (!p || p.scope.kind === 'all') return;
    const path = p.scope.kind === 'client' ? `/clients/${p.scope.id}` : `/projects/${p.scope.id}`;
    const body = { spaceBlocks: p.blocks };
    if (opts.keepalive) {
      // Page is going away: React Query may never see the response, so use
      // a keepalive fetch directly (browsers cap keepalive bodies ~64KB).
      const size = JSON.stringify(body).length;
      if (size < 60_000) {
        void api.patch(path, body, { keepalive: true }).catch(() => undefined);
        return;
      }
    }
    const { updateClient: uc, updateProject: up } = mutators.current;
    const m = p.scope.kind === 'client' ? uc : up;
    void m.mutateAsync({ id: p.scope.id, patch: body }).catch(() => undefined);
  }, []);

  // Flush (never drop) a pending save when the scope changes or the canvas
  // unmounts, and when the tab is hidden or the page is being unloaded.
  const scopeKey = scope && scope.kind !== 'all' ? `${scope.kind}:${scope.id}` : null;
  useEffect(() => () => send(), [scopeKey, send]);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') send({ keepalive: true });
    };
    const onPageHide = () => send({ keepalive: true });
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [send]);

  return useCallback((next: SpaceBlock[]) => {
    const s = scopeRef.current;
    if (!s || s.kind === 'all') return;
    // A pending save for a different scope goes out first.
    if (pending.current && pending.current.scope !== s &&
        (pending.current.scope.kind !== s.kind || (pending.current.scope as { id: string }).id !== s.id)) {
      send();
    }
    pending.current = { scope: s, blocks: next };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => send(), 250);
  }, [send]);
}

/** Immediate full-replace writer for the active Space's `spaceFiles`. */
export function useUpdateSpaceFiles(scope: Scope | null) {
  const updateClient = useUpdateClient();
  const updateProject = useUpdateProject();
  return async (next: SpaceFile[]) => {
    if (!scope || scope.kind === 'all') return;
    if (scope.kind === 'client') {
      await updateClient.mutateAsync({ id: scope.id, patch: { spaceFiles: next } });
    } else {
      await updateProject.mutateAsync({ id: scope.id, patch: { spaceFiles: next } });
    }
  };
}
