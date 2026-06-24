import { API_URL } from './env';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

// The client portal is stateless: its session token (minted at /portal/exchange)
// is stored in localStorage and sent on every request as X-Portal-Token. Staff
// routes ignore it (they use the Supabase JWT); portal routes verify it.
export const PORTAL_TOKEN_KEY = 'portal-token';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (typeof window !== 'undefined') {
    const pt = window.localStorage.getItem(PORTAL_TOKEN_KEY);
    if (pt) headers['X-Portal-Token'] = pt;
  }
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    credentials: 'include',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const contentType = res.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    throw new ApiError(res.status, typeof payload === 'string' ? payload : (payload?.error ?? 'request_failed'), payload);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
