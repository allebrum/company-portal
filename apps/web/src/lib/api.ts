import { API_URL } from './env';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
    public method?: string,
    public path?: string,
    public url?: string,
  ) {
    super(message);
  }
}

export type RequestOptions = {
  /** Let the request outlive the page (pagehide/unload flushes). Body must be < ~64KB. */
  keepalive?: boolean;
  /** Extra request headers (e.g. x-expected-updated-at for versioned saves). */
  headers?: Record<string, string>;
};

// ---------------------------------------------------------------------------
// Session loss. A 401 from a staff API route means the session cookie is no
// longer valid (expired, revoked, or the Redis entry is gone). Listeners
// (AuthProvider) are told once per 401 so they can end the session in one
// place: one redirect to /login instead of every query and save handling it
// on its own. While the session is marked lost, staff requests fail fast
// without touching the network, so nothing can storm the API.
// ---------------------------------------------------------------------------

type UnauthorizedListener = (e: ApiError) => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();
let sessionLost = false;

/** Subscribe to "a staff request came back 401". Returns an unsubscribe. */
export function onUnauthorized(fn: UnauthorizedListener): () => void {
  unauthorizedListeners.add(fn);
  return () => {
    unauthorizedListeners.delete(fn);
  };
}

/** Set by AuthProvider when it ends the session; cleared on sign-in. */
export function setSessionLost(lost: boolean): void {
  sessionLost = lost;
}

export function isSessionLost(): boolean {
  return sessionLost;
}

/**
 * Does a 401 on this path mean "the staff session is gone"? Not for the auth
 * endpoints themselves (a wrong password or 2FA code is a 401 too, and
 * /auth/me is how sign-in state is read), nor for the client portal and
 * public QR uploads, which have their own auth.
 */
export function isSessionPath(path: string): boolean {
  if (path.startsWith('/portal') || path.startsWith('/upload/')) return false;
  if (path.startsWith('/auth/')) return path.startsWith('/auth/switch-workspace');
  return true;
}

export function isUnauthorized(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const url = `${API_URL}/api${path}`;
  const sessionPath = isSessionPath(path);
  if (sessionLost && sessionPath) {
    throw new ApiError(401, `[${method} ${path}] session_expired`, { error: 'session_expired' }, method, path, url);
  }
  const res = await fetch(url, {
    method,
    credentials: 'include',
    keepalive: opts.keepalive || undefined,
    headers: body || opts.headers
      ? { ...(body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers }
      : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const contentType = res.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const detail = typeof payload === 'string' ? payload : (payload?.error ?? 'request_failed');
    const err = new ApiError(res.status, `[${method} ${path}] ${detail}`, payload, method, path, url);
    if (res.status === 401 && sessionPath) {
      for (const fn of [...unauthorizedListeners]) {
        try {
          fn(err);
        } catch {
          // a listener must never mask the original error
        }
      }
    }
    throw err;
  }
  return payload as T;
}

/** Header the API checks for optimistic concurrency (409 stale_update). */
export const EXPECTED_UPDATED_AT_HEADER = 'x-expected-updated-at';

/** True for the API's "someone saved this row after you loaded it" error. */
export function isStaleUpdate(e: unknown): boolean {
  return e instanceof ApiError && e.status === 409 &&
    (e.body as { error?: string } | undefined)?.error === 'stale_update';
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, body, opts),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
