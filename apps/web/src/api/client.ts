export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  /** The API path that failed, e.g. '/b/DHN/sales' (lets the cache react to branch 404s). */
  readonly path?: string;
  constructor(status: number, code: string, message: string, details?: unknown, path?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.path = path;
  }
}

let accessToken: string | null = null;
export const getAccessToken = () => accessToken;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

async function send(path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has('Content-Type'))
    headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  return fetch(`/api${path}`, { ...init, headers, credentials: 'include' });
}

async function parse<T>(res: Response, path: string): Promise<T> {
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = data?.error;
    throw new ApiError(
      res.status,
      e?.code ?? 'NETWORK_ERROR',
      e?.message ?? 'Request failed',
      e?.details,
      path,
    );
  }
  return data as T;
}

/**
 * Web Locks only exist in secure contexts (https or localhost). On plain http over the LAN
 * (e.g. testing on a tablet at http://192.168.x.x:5173) fall back to the in-tab single-flight only.
 */
const withRefreshLock = <T>(fn: () => Promise<T>): Promise<T> =>
  typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request('shopstock-refresh', fn)
    : fn();

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time, in this tab (single-flight) AND across tabs (Web Lock). */
export function refreshAccessToken(): Promise<boolean> {
  refreshing ??= withRefreshLock(async () => {
    const res = await send('/auth/refresh', { method: 'POST' });
    if (!res.ok) {
      setAccessToken(null);
      return false;
    }
    const { accessToken: next } = (await res.json()) as { accessToken: string };
    setAccessToken(next);
    return true;
  }).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await send(path, init);
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Network error. Check your connection.'); // the POS shows Retry for this
  }
  // Auth and setup endpoints answer 401 for wrong passwords: never try to refresh for them.
  if (res.status === 401 && !path.startsWith('/auth/') && !path.startsWith('/setup')) {
    if (await refreshAccessToken()) res = await send(path, init); // retry once
  }
  return parse<T>(res, path);
}

const body = (b: unknown) => (b === undefined ? undefined : JSON.stringify(b));

export const http = {
  get: <T>(p: string) => api<T>(p),
  post: <T>(p: string, b?: unknown) => api<T>(p, { method: 'POST', body: body(b ?? {}) }),
  patch: <T>(p: string, b: unknown) => api<T>(p, { method: 'PATCH', body: body(b) }),
  put: <T>(p: string, b: unknown) => api<T>(p, { method: 'PUT', body: body(b) }),
  delete: <T>(p: string, b?: unknown) => api<T>(p, { method: 'DELETE', body: body(b) }),
};
