import { Composio } from '@composio/core';
import { env } from '../env.js';

// Composio (productivity/SaaS tools) — server-only, Composio-managed OAuth.
// We never store raw provider credentials; Composio holds + refreshes the
// tokens, keyed by our stable per-client `user_id` (= the client's id).
//
// SDK method names verified against docs.composio.dev. The SDK's exact result
// shapes vary by version, so reads are extracted defensively and validated live.

/* eslint-disable @typescript-eslint/no-explicit-any */

let _composio: Composio | null = null;

export function getComposio(): Composio {
  if (!env.COMPOSIO_API_KEY) throw new Error('COMPOSIO_API_KEY is not configured');
  if (!_composio) _composio = new Composio({ apiKey: env.COMPOSIO_API_KEY });
  return _composio;
}

// One Composio-managed auth config per toolkit, reused across all clients.
const authConfigCache = new Map<string, string>();

export async function ensureAuthConfig(toolkit: string): Promise<string> {
  const key = toolkit.toLowerCase();
  const cached = authConfigCache.get(key);
  if (cached) return cached;

  const composio: any = getComposio();
  // Reuse an existing managed auth config for this toolkit if present.
  try {
    const existing = await composio.authConfigs.list({ toolkit: toolkit.toUpperCase() });
    const items = existing?.items ?? existing ?? [];
    const found = (Array.isArray(items) ? items : []).find((c: any) => {
      const slug = (c?.toolkit?.slug ?? c?.toolkit ?? c?.toolkitSlug ?? '').toString().toLowerCase();
      return slug === key;
    });
    if (found?.id) {
      authConfigCache.set(key, found.id);
      return found.id;
    }
  } catch {
    /* fall through to create */
  }

  const created = await composio.authConfigs.create(toolkit.toUpperCase(), {
    name: `${toolkit} (Modern Zen managed)`,
    type: 'use_composio_managed_auth',
  });
  const id = created?.id;
  if (!id) throw new Error('composio_auth_config_failed');
  authConfigCache.set(key, id);
  return id;
}

/** Begin managed-OAuth for a toolkit; returns the URL to send the user to. */
export async function startConnect(composioUserId: string, toolkit: string, callbackUrl: string): Promise<string> {
  const composio: any = getComposio();
  const authConfigId = await ensureAuthConfig(toolkit);
  const conn = await composio.connectedAccounts.link(composioUserId, authConfigId, { callbackUrl });
  const redirectUrl = conn?.redirectUrl;
  if (!redirectUrl) throw new Error('composio_link_no_redirect');
  return redirectUrl;
}

export interface ComposioConnectedAccount {
  id: string;
  toolkit: string;
  status: string;
}

/** A client's connected accounts (the source of truth we cache into `connections`). */
export async function listConnected(composioUserId: string): Promise<ComposioConnectedAccount[]> {
  const composio: any = getComposio();
  const res = await composio.connectedAccounts.list({ userIds: [composioUserId] });
  const items = res?.items ?? res ?? [];
  return (Array.isArray(items) ? items : [])
    .map((a: any) => ({
      id: a?.id,
      toolkit: (a?.toolkit?.slug ?? a?.toolkit ?? a?.toolkitSlug ?? a?.appName ?? '').toString().toLowerCase(),
      status: (a?.status ?? 'ACTIVE').toString(),
    }))
    .filter((a: ComposioConnectedAccount) => !!a.id);
}

/** Remove a connected account (one-click Disconnect). */
export async function disconnect(connectedAccountId: string): Promise<void> {
  const composio: any = getComposio();
  await composio.connectedAccounts.delete(connectedAccountId);
}

/** Provider-agnostic tools available to a user (for an LLM / direct execution). */
export async function getTools(composioUserId: string, opts: { toolkits?: string[]; tools?: string[] }): Promise<unknown> {
  const composio: any = getComposio();
  return composio.tools.get(composioUserId, opts);
}

/** Execute one tool on behalf of a user. */
export async function executeTool(
  slug: string,
  composioUserId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const composio: any = getComposio();
  return composio.tools.execute(slug, { userId: composioUserId, arguments: args });
}
