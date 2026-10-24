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

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const url = `${API_URL}/api${path}`;
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
    throw new ApiError(res.status, `[${method} ${path}] ${detail}`, payload, method, path, url);
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
