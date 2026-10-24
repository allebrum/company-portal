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
};

async function request<T>(method: string, path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const url = `${API_URL}/api${path}`;
  const res = await fetch(url, {
    method,
    credentials: 'include',
    keepalive: opts.keepalive || undefined,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
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

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, body, opts),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
