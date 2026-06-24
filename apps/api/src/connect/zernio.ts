import { env } from '../env.js';

// Zernio (a.k.a. Late) REST client — social channels. All calls are server-side
// with the server-only ZERNIO_API_KEY; the key is never exposed to the browser.
// Contract verified against the Zernio API docs (profile-per-client model).

const ZERNIO_BASE = 'https://zernio.com/api/v1';

function apiKey(): string {
  if (!env.ZERNIO_API_KEY) throw new Error('ZERNIO_API_KEY is not configured');
  return env.ZERNIO_API_KEY;
}

async function zfetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${ZERNIO_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const ct = res.headers.get('content-type') ?? '';
  const payload: unknown = ct.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const obj = typeof payload === 'object' && payload ? (payload as { error?: string; message?: string }) : null;
    const msg = typeof payload === 'string' ? payload : (obj?.error ?? obj?.message ?? 'zernio_request_failed');
    throw new Error(`Zernio ${res.status}: ${msg}`);
  }
  return payload as T;
}

/** One profile per client. Returns the profile id (`_id`). */
export async function createProfile(name: string, description: string): Promise<string> {
  const { profile } = await zfetch<{ profile: { _id: string } }>('/profiles', {
    method: 'POST',
    body: JSON.stringify({ name, description }),
  });
  return profile._id;
}

/** OAuth connect URL for a platform on a profile. Standard mode (Zernio hosts
 *  the selection UI). The callback appends ?connected&profileId&accountId&username. */
export async function getConnectUrl(profileId: string, platform: string, redirectUrl: string): Promise<string> {
  const qs = new URLSearchParams({ profileId, redirect_url: redirectUrl });
  const { authUrl } = await zfetch<{ authUrl: string }>(`/connect/${encodeURIComponent(platform)}?${qs.toString()}`);
  return authUrl;
  // TODO(headless): for LinkedIn orgs / Snapchat profiles, pass headless=true and
  // resolve the selection via the one-time pendingDataToken + /connect/{p}/select-*.
}

export interface ZernioAccount {
  _id: string;
  platform: string;
  username?: string;
  status?: string;
}

/** A profile's connected social accounts. */
export async function listAccounts(profileId: string): Promise<ZernioAccount[]> {
  const qs = new URLSearchParams({ profileId });
  const out = await zfetch<{ accounts?: ZernioAccount[] } | ZernioAccount[]>(`/accounts?${qs.toString()}`);
  return Array.isArray(out) ? out : (out.accounts ?? []);
}

export interface ZernioPlatformTarget {
  platform: string;
  accountId: string;
}

export interface CreatePostInput {
  content: string;
  platforms: ZernioPlatformTarget[];
  publishNow?: boolean;
  scheduledFor?: string;
  timezone?: string;
  queuedFromProfile?: string;
}

/** Create (publish-now / scheduled / queued) a post across the given accounts. */
export async function createPost(input: CreatePostInput): Promise<{ _id: string }> {
  const { post } = await zfetch<{ post: { _id: string } }>('/posts', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return post;
}

/** Disconnect + remove a connected social account. */
export async function disconnectAccount(accountId: string): Promise<void> {
  await zfetch(`/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
}

/** Account/post analytics. Param shape is refined in the workflows milestone. */
export async function getAnalytics(query: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams(query);
  return zfetch(`/analytics?${qs.toString()}`);
}
