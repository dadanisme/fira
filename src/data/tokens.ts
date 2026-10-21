import type { CreateTokenBody, CreateTokenResult, Page_ } from '@shared/api';
import type { ApiToken, LabelColor } from '@shared/types';
import { apiFetch, seg } from './api';

/**
 * API tokens of a workspace, through the REST API (tokens are never read from Firestore
 * by clients). Members see their own; admins and the owner see all of the workspace's.
 */

const tokens = (wid: string) => `/workspaces/${seg(wid)}/tokens`;

export async function listTokens(wid: string): Promise<ApiToken[]> {
  const out: ApiToken[] = [];
  let cursor: string | null = null;
  do {
    const qs = new URLSearchParams({ limit: '200', ...(cursor && { cursor }) });
    const page: Page_<ApiToken> = await apiFetch('GET', `${tokens(wid)}?${qs}`);
    out.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

/** Creates a token for the caller in this workspace; the secret is in the result only. */
export function createToken(wid: string, name: string, color?: LabelColor): Promise<CreateTokenResult> {
  const body: CreateTokenBody = { name, ...(color && { color }) };
  return apiFetch('POST', tokens(wid), body);
}

/** Revokes a token (own, or any as an admin/owner). */
export function revokeToken(wid: string, id: string): Promise<ApiToken> {
  return apiFetch('DELETE', `${tokens(wid)}/${seg(id)}`);
}
