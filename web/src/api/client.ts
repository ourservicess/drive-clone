/** Error thrown for any non-2xx API response, carrying the server's error code. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Fired when the server says the session is gone; AuthContext listens for it. */
export const SESSION_EXPIRED_EVENT = 'drive:session-expired';

export function toApiError(status: number, body: unknown): ApiError {
  const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
  return new ApiError(
    status,
    err?.code ?? 'HTTP_ERROR',
    err?.message ?? (status >= 500 ? 'Server error. Please try again.' : `Request failed (${status})`),
  );
}

interface FetchOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  json?: unknown;
  signal?: AbortSignal;
}

/**
 * Small wrapper around fetch:
 * - sends/receives JSON
 * - includes the session cookie
 * - turns error responses into ApiError
 */
export async function api<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.json !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection.');
  }

  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const error = toApiError(res.status, body);
    if (error.code === 'UNAUTHENTICATED' && !path.startsWith('/auth/me')) {
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw error;
  }
  return body as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return 'Something went wrong';
}
