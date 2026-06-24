'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
  useClients,
  useProjects,
  useUpdateClient,
  useUpdateProject,
  type ClientRow,
  type ProjectRow,
} from '@/hooks/useResources';
import type { SpaceBlock, SpaceFile } from '@modernzen/shared';
import type { Scope } from '@/lib/roadmap';

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
  const pending = useRef<SpaceBlock[] | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (next: SpaceBlock[]) => {
    pending.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const payload = pending.current;
      if (!scope || scope.kind === 'all' || !payload) return;
      if (scope.kind === 'client') {
        void updateClient.mutateAsync({ id: scope.id, patch: { spaceBlocks: payload } });
      } else {
        void updateProject.mutateAsync({ id: scope.id, patch: { spaceBlocks: payload } });
      }
      pending.current = null;
    }, 250);
  };
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
