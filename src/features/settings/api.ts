import type { ApiToken, LabelColor } from '@shared/types';
import { auth } from '../../lib/firebase';

/** Calls the REST API as the owner (Firebase ID token), for token management. */
async function ownerFetch<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
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
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(res.ok ? 'The API returned an unexpected response (is it running?)' : `API error ${res.status}`);
  }
  if (!res.ok) {
    const message = (json as { error?: { message?: string } } | null)?.error?.message;
    throw new Error(message ?? `API error ${res.status}`);
  }
  return json as T;
}

export async function listTokens(): Promise<ApiToken[]> {
  const out: ApiToken[] = [];
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ limit: '200', ...(cursor && { cursor }) });
    const page: { items: ApiToken[]; nextCursor: string | null } = await ownerFetch('GET', `/tokens?${qs}`);
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

export function createToken(name: string, color?: LabelColor): Promise<{ token: ApiToken; secret: string }> {
  return ownerFetch('POST', '/tokens', { name, ...(color && { color }) });
}

export function revokeToken(id: string): Promise<ApiToken> {
  return ownerFetch('DELETE', `/tokens/${encodeURIComponent(id)}`);
}
