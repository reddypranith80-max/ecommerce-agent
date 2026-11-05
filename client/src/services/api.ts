import type { AuthResult, PageMeta } from '@shop/shared';
import { useSession } from '../store/session';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
  }

  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    return Object.fromEntries((this.details as { path: string; message: string }[]).map((d) => [d.path, d.message]));
  }
}

export function errorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof TypeError) return 'Cannot reach the server. Is it running?';
  return fallback;
}

const BASE = '/api/v1';

// ---------------------------------------------------------------- session refresh (single-flight, shared across tabs)

const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('storefront-auth') : null;
type AuthMessage = { type: 'refreshed'; result: AuthResult } | { type: 'logout' };

channel?.addEventListener('message', (e: MessageEvent<AuthMessage>) => {
  if (e.data.type === 'refreshed') useSession.getState().setSession(e.data.result.user, e.data.result.accessToken);
  if (e.data.type === 'logout') {
    useSession.getState().clear();
    onLogoutHandlers.forEach((h) => h());
  }
});

const onLogoutHandlers = new Set<() => void>();
export function onRemoteLogout(handler: () => void) {
  onLogoutHandlers.add(handler);
  return () => {
    onLogoutHandlers.delete(handler);
  };
}

let inFlight: Promise<string | null> | null = null;

async function doRefresh(tokenBefore: string | null): Promise<string | null> {
  // Another tab may have refreshed while we waited for the lock.
  const current = useSession.getState().accessToken;
  if (current && current !== tokenBefore) return current;
  const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { 'X-Requested-With': 'fetch' }, credentials: 'same-origin' });
  if (!res.ok || res.status === 204) {
    useSession.getState().clear();
    return null;
  }
  const { data } = (await res.json()) as { data: AuthResult };
  useSession.getState().setSession(data.user, data.accessToken);
  channel?.postMessage({ type: 'refreshed', result: data } satisfies AuthMessage);
  return data.accessToken;
}

/** Exchanges the httpOnly refresh cookie for a new access token. Serialised across tabs with Web Locks. */
export function refreshSession(): Promise<string | null> {
  if (!inFlight) {
    const before = useSession.getState().accessToken;
    const run = () => doRefresh(before);
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    inFlight = (locks ? (locks.request('storefront-refresh', run) as unknown as Promise<string | null>) : run())
      .catch(() => {
        useSession.getState().clear();
        return null;
      })
      .finally(() => {
        inFlight = null;
      });
  }
  return inFlight!;
}

export function broadcastLogout() {
  channel?.postMessage({ type: 'logout' } satisfies AuthMessage);
}

// ---------------------------------------------------------------- requests

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function send(path: string, opts: RequestOptions, token: string | null) {
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
    credentials: 'same-origin',
    signal: opts.signal,
  });
}

/** Low-level request returning the parsed JSON envelope. Retries once after refreshing an expired token. */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const token = useSession.getState().accessToken;
  let res = await send(path, opts, token);
  if (res.status === 401 && token) {
    const body = (await res.clone().json().catch(() => null)) as { error?: { code?: string } } | null;
    if (body?.error?.code === 'TOKEN_EXPIRED' || body?.error?.code === 'UNAUTHENTICATED') {
      const fresh = await refreshSession();
      if (fresh) res = await send(path, opts, fresh);
    }
  }
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => null)) as
    | { error?: { code: string; message: string; details?: unknown; requestId?: string } }
    | null;
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? 'HTTP_ERROR', e?.message ?? `Request failed (${res.status}).`, e?.details, e?.requestId);
  }
  return json as T;
}

export const api = {
  get: async <T>(path: string, signal?: AbortSignal) => (await request<{ data: T }>(path, { signal })).data,
  page: async <T, M = PageMeta>(path: string, signal?: AbortSignal) => request<{ data: T[]; meta: M }>(path, { signal }),
  post: async <T>(path: string, body?: unknown, headers?: Record<string, string>) =>
    (await request<{ data: T } | undefined>(path, { method: 'POST', body: body ?? {}, headers }))?.data as T,
  put: async <T>(path: string, body?: unknown) => (await request<{ data: T } | undefined>(path, { method: 'PUT', body: body ?? {} }))?.data as T,
  patch: async <T>(path: string, body: unknown) => (await request<{ data: T } | undefined>(path, { method: 'PATCH', body }))?.data as T,
  del: async (path: string) => {
    await request(path, { method: 'DELETE' });
  },
};

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') usp.set(k, String(v));
  const s = usp.toString();
  return s ? `?${s}` : '';
}

/** Downloads an authenticated file (e.g. CSV) by fetching it with the access token. */
export async function downloadFile(path: string, filename: string) {
  let token = useSession.getState().accessToken;
  let res = await send(path, {}, token);
  if (res.status === 401) {
    token = await refreshSession();
    res = await send(path, {}, token);
  }
  if (!res.ok) throw new ApiError(res.status, 'HTTP_ERROR', 'Download failed.');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
