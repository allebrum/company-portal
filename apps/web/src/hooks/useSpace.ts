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
import {
  api,
  isStaleUpdate,
  isSessionLost,
  isUnauthorized,
  onUnauthorized,
  EXPECTED_UPDATED_AT_HEADER,
} from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { draftKey, saveDraft } from '@/components/space/notes/drafts';
import { isNewerVersion, mergeBlocks, sameBlocks } from '@/components/space/notes/merge';

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

type SpaceRef = { kind: 'client' | 'project'; id: string };
type Synced = { blocks: SpaceBlock[]; updatedAt: string | null };
type ServerBlocks = { id: string; blocks: SpaceBlock[]; updatedAt: string };

const keyOf = (s: SpaceRef) => `${s.kind}:${s.id}`;
const asRef = (s: Scope | null): SpaceRef | null =>
  s && s.kind !== 'all' ? { kind: s.kind, id: s.id } : null;

export type SpaceBlocksSync = {
  /** Queue a debounced save of the editor's full block list. Returns false
   *  when there is nothing to send (it equals the last-synced snapshot). */
  save: (next: SpaceBlock[]) => boolean;
  /** Record the server snapshot (blocks + row version) the editor loaded. */
  hydrate: (scope: Scope, blocks: SpaceBlock[], updatedAt: string | null | undefined) => void;
  /** Fetch the server copy and merge it in if it moved past what we synced.
   *  `hint` (an updatedAt from a socket event) skips the fetch when it is ours. */
  pull: (hint?: string) => Promise<void>;
};

/**
 * Versioned, conflict-merging writer for the active Space's `spaceBlocks`.
 *
 * The Notes canvas calls `save(nextBlocks)` after every edit; bursts are
 * coalesced into one PATCH every 250ms. Each PATCH carries the row version
 * the editor last synced (x-expected-updated-at). If someone else wrote in
 * between (a bot append, another tab), the API answers 409; we then fetch
 * the server blocks, three-way merge them with ours (notes/merge.ts, base =
 * last-synced snapshot), hand the server copy to `onRemote` so the live
 * editor merges it too, and retry with the new version. Keystrokes typed
 * while that happens queue up behind it and go out in the next PATCH.
 *
 * `pull()` does the same merge without a save, for Socket.IO change notices.
 *
 * When the session ends (a 401 here or anywhere else), nothing is retried:
 * edits that didn't reach the server are stashed in localStorage
 * (notes/drafts.ts) and merged back in after the user signs in again.
 *
 * Files-tab writes don't use this — those are discrete user actions
 * (upload, paste link, remove) and warrant immediate writes via
 * useUpdateSpaceFiles.
 */
export function useUpdateSpaceBlocks(
  scope: Scope | null,
  opts: { onRemote?: (scope: SpaceRef, base: SpaceBlock[], server: SpaceBlock[]) => void } = {},
): SpaceBlocksSync {
  const updateClient = useUpdateClient();
  const updateProject = useUpdateProject();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pending payloads are keyed by Space, so a flush after a client→project
  // hop still writes to the right row and never overwrites the other's.
  const pending = useRef(new Map<string, { scope: SpaceRef; blocks: SpaceBlock[] }>());
  const synced = useRef(new Map<string, Synced>());
  const inFlight = useRef(false);
  // A pull requested while a save was in flight: the newest notice's
  // version (so our own save's echo can be skipped), or null for "pull".
  const pullWanted = useRef<{ hint: string | null } | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const mutators = useRef({ updateClient, updateProject });
  mutators.current = { updateClient, updateProject };
  // Remember who is editing: by the time a 401 lands, `me` may be clearing.
  const { me } = useAuth();
  const userIdRef = useRef<string | null>(null);
  if (me?.id) userIdRef.current = me.id;

  // Session over: keep unsent edits on this device instead of sending them.
  // Newest blocks stashed per Space, so a later, older in-flight copy
  // (the request that got the 401) never overwrites them.
  const stashed = useRef(new Map<string, SpaceBlock[]>());
  const stash = (key: string, ref: SpaceRef, blocks: SpaceBlock[]) => {
    stashed.current.set(key, blocks);
    const uid = userIdRef.current;
    const base = synced.current.get(key);
    if (!uid || (base && sameBlocks(blocks, base.blocks))) return;
    saveDraft(draftKey(uid, ref.kind, ref.id), {
      blocks,
      base: base?.blocks ?? [],
      baseUpdatedAt: base?.updatedAt ?? null,
    });
  };
  const stashPending = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    for (const [key, p] of pending.current) stash(key, p.scope, p.blocks);
    pending.current.clear();
    pullWanted.current = null;
  };

  const setSynced = (key: string, v: Synced) => {
    synced.current.set(key, v);
  };
  const isCurrent = (ref: SpaceRef) => {
    const cur = asRef(scopeRef.current);
    return !!cur && keyOf(cur) === keyOf(ref);
  };
  const fetchServer = (ref: SpaceRef) => api.get<ServerBlocks>(`/spaces/${ref.kind}/${ref.id}/blocks`);

  const pullRef = useRef<SpaceBlocksSync['pull']>(async () => undefined);

  const send = useCallback(async (o: { keepalive?: boolean } = {}) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (isSessionLost()) {
      stashPending(); // never send while signed out (incl. unmount/pagehide flushes)
      return;
    }
    if (inFlight.current) {
      // Page going away mid-save: the loop below can't run again, so push
      // the newest edits out now. Versioned, so at worst this one 409s
      // (dropping <250ms of typing) instead of wiping someone else's blocks.
      if (o.keepalive) {
        for (const p of pending.current.values()) {
          const v = synced.current.get(keyOf(p.scope))?.updatedAt;
          const path = p.scope.kind === 'client' ? `/clients/${p.scope.id}` : `/projects/${p.scope.id}`;
          const body = { spaceBlocks: p.blocks };
          if (JSON.stringify(body).length < 60_000) {
            void api.patch(path, body, {
              keepalive: true,
              headers: v ? { [EXPECTED_UPDATED_AT_HEADER]: v } : undefined,
            }).catch(() => undefined);
          }
        }
      }
      return; // the running loop picks up whatever is pending
    }
    inFlight.current = true;
    let conflicts = 0;
    try {
      for (;;) {
        const next = pending.current.entries().next();
        if (next.done) break;
        const [key, p] = next.value;
        pending.current.delete(key);
        const base = synced.current.get(key);
        if (base && sameBlocks(p.blocks, base.blocks)) continue; // nothing new to send
        const { updateClient: uc, updateProject: up } = mutators.current;
        const m = p.scope.kind === 'client' ? uc : up;
        // Browsers cap keepalive bodies (~64KB); larger docs go as normal requests.
        const keepalive = o.keepalive && JSON.stringify(p.blocks).length < 60_000;
        try {
          const row = await m.mutateAsync({
            id: p.scope.id,
            patch: { spaceBlocks: p.blocks },
            expectedUpdatedAt: base?.updatedAt ?? undefined,
            keepalive,
          });
          setSynced(key, { blocks: p.blocks, updatedAt: row.updatedAt ?? null });
          conflicts = 0;
        } catch (e) {
          if (isUnauthorized(e)) {
            // Session ended: keep the newest edits locally and stop.
            stash(key, p.scope, pending.current.get(key)?.blocks ?? stashed.current.get(key) ?? p.blocks);
            pending.current.delete(key);
            stashPending();
            break;
          }
          if (!isStaleUpdate(e) || conflicts >= 5) continue; // fire-and-forget as before; the next edit resends
          conflicts++;
          // Someone saved after us. Merge their copy with ours and retry.
          let server: ServerBlocks;
          try {
            server = await fetchServer(p.scope);
          } catch (fe) {
            if (isUnauthorized(fe)) {
              stash(key, p.scope, pending.current.get(key)?.blocks ?? stashed.current.get(key) ?? p.blocks);
              pending.current.delete(key);
              stashPending();
              break;
            }
            continue;
          }
          const baseBlocks = base?.blocks ?? [];
          // Newest local edits: anything typed during the round trips, else what we tried to send.
          const local = pending.current.get(key)?.blocks ?? p.blocks;
          setSynced(key, { blocks: server.blocks, updatedAt: server.updatedAt });
          pending.current.set(key, { scope: p.scope, blocks: mergeBlocks(baseBlocks, local, server.blocks) });
          if (isCurrent(p.scope)) optsRef.current.onRemote?.(p.scope, baseBlocks, server.blocks);
        }
      }
    } finally {
      inFlight.current = false;
    }
    if (isSessionLost()) stashPending();
    else if (pending.current.size > 0) void send(); // queued while the last response was in flight
    else if (pullWanted.current) {
      const { hint } = pullWanted.current;
      pullWanted.current = null;
      void pullRef.current(hint ?? undefined);
    }
    // stash/stashPending only touch refs, so the stable identity is safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pull = useCallback<SpaceBlocksSync['pull']>(async (hint) => {
    const ref = asRef(scopeRef.current);
    if (!ref || isSessionLost()) return;
    const key = keyOf(ref);
    const before = synced.current.get(key);
    if (!before) return; // not hydrated yet
    if (hint && !isNewerVersion(hint, before.updatedAt)) return; // our own save echoing back (or older)
    if (inFlight.current) {
      // The in-flight save will 409 (and merge), or we pull right after it.
      const prev = pullWanted.current;
      const keepHint = prev ? prev.hint !== null && hint !== undefined : hint !== undefined;
      pullWanted.current = {
        hint: keepHint ? (prev && isNewerVersion(prev.hint, hint) ? prev.hint : hint!) : null,
      };
      return;
    }
    let server: ServerBlocks;
    try {
      server = await fetchServer(ref);
    } catch {
      return;
    }
    if (inFlight.current) {
      pullWanted.current = { hint: null }; // let the save (or its 409 merge) settle first
      return;
    }
    // Merge against the snapshot as it is *now*: a save may have landed
    // during the fetch. Only a strictly newer server copy has anything new.
    const cur = synced.current.get(key);
    if (!cur || !isNewerVersion(server.updatedAt, cur.updatedAt)) return;
    setSynced(key, { blocks: server.blocks, updatedAt: server.updatedAt });
    const p = pending.current.get(key);
    if (p) pending.current.set(key, { scope: p.scope, blocks: mergeBlocks(cur.blocks, p.blocks, server.blocks) });
    if (isCurrent(ref)) optsRef.current.onRemote?.(ref, cur.blocks, server.blocks);
  }, [send]);
  pullRef.current = pull;

  // Flush (never drop) a pending save when the scope changes or the canvas
  // unmounts, and when the tab is hidden or the page is being unloaded.
  const scopeKey = scope && scope.kind !== 'all' ? `${scope.kind}:${scope.id}` : null;
  // Any staff 401 (not just ours) ends the session: stash what's queued.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onUnauthorized(() => stashPending()), []);
  useEffect(() => () => void send(), [scopeKey, send]);
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void send({ keepalive: true });
      else void pullRef.current(); // back in view: catch up on anything missed
    };
    const onPageHide = () => void send({ keepalive: true });
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [send]);

  const save = useCallback((next: SpaceBlock[]) => {
    const ref = asRef(scopeRef.current);
    if (!ref) return false;
    const key = keyOf(ref);
    if (isSessionLost()) {
      stash(key, ref, next); // signed out: keep it for after sign-in
      return false;
    }
    const base = synced.current.get(key);
    if (!inFlight.current && base && sameBlocks(next, base.blocks)) {
      pending.current.delete(key); // e.g. a remote merge with no local edits
      return false;
    }
    pending.current.set(key, { scope: ref, blocks: next });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void send(), 250);
    return true;
  }, [send]);

  const hydrate = useCallback<SpaceBlocksSync['hydrate']>((s, blocks, updatedAt) => {
    const ref = asRef(s);
    if (!ref) return;
    const key = keyOf(ref);
    // Don't clobber a newer snapshot from a save that's still settling.
    if (inFlight.current && synced.current.has(key)) return;
    setSynced(key, { blocks, updatedAt: updatedAt ?? null });
  }, []);

  return useMemo(() => ({ save, hydrate, pull }), [save, hydrate, pull]);
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
