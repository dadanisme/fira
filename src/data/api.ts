import type { ApiErrorCode } from '@shared/api';
import { auth } from '../lib/firebase';

/** An error response from the REST API; `code` tells e.g. `slug_taken` from `seat_limit`. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | 'internal' | 'unknown';

  constructor(status: number, code: ApiError['code'], message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Calls `/api/v1<path>` as the signed-in user (Firebase ID token bearer). Resolves to the
 * parsed JSON body (`undefined` for an empty body, e.g. 204); rejects with `ApiError`.
 */
export async function apiFetch<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new Error('Not signed in');
  const idToken = await user.getIdToken();
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${idToken}`,
      ...(body !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    // Vercel answers some errors (e.g. 413 body too large) in plain text, before our code runs.
    if (res.ok) throw new ApiError(res.status, 'unknown', 'The API returned an unexpected response (is it running?)');
    throw new ApiError(res.status, 'unknown', res.status === 413 ? 'The request is too large' : `API error ${res.status}`);
  }
  if (!res.ok) {
    const error = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiError(res.status, (error?.code as ApiError['code'] | undefined) ?? 'unknown', error?.message ?? `API error ${res.status}`);
  }
  return json as T;
}

/** `encodeURIComponent` for path segments. */
export const seg = encodeURIComponent;
