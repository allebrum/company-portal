import { API_URL } from './env';
import { getSupabase } from './supabase';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

// Two auth tracks share this client:
//  - Staff: the Supabase session JWT, sent as `Authorization: Bearer`.
//  - Client portal: a stateless token (minted at /portal/exchange), kept in
//    localStorage and sent as `X-Portal-Token`.
// A request carries whichever it has; the API uses the relevant one.
export const PORTAL_TOKEN_KEY = 'portal-token';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (typeof window !== 'undefined') {
    try {
      const { data } = await getSupabase().auth.getSession();
      if (data.session?.access_token) {
        headers['Authorization'] = `Bearer ${data.session.access_token}`;
        const tenant = window.localStorage.getItem('active-tenant');
        if (tenant) headers['x-tenant-id'] = tenant;
      }
    } catch {
      /* no supabase session — portal or logged-out */
    }
    const pt = window.localStorage.getItem(PORTAL_TOKEN_KEY);
    if (pt) headers['X-Portal-Token'] = pt;
  }
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
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
