import type {
  AcceptResult,
  CreateInviteBody,
  CreateWorkspaceBody,
  DeleteWorkspaceBody,
  InviteResult,
  SetRoleBody,
  TransferBody,
  UpdateWorkspaceBody,
} from '@shared/api';
import type { InviteRole, Member, Workspace } from '@shared/types';
import { normalizeEmail } from '@shared/actors';
import { auth } from '../lib/firebase';
import { apiFetch, seg } from './api';

/**
 * Workspace, member and invite changes: server operations through the REST API (the rules
 * allow no client writes to workspaces, members or invites). Not optimistic; they resolve
 * once the server has committed, and the live hooks (members.ts) then pick the change up.
 * Errors are `ApiError`s (./api), with codes such as `slug_taken` or `seat_limit`.
 */

const ws = (wid: string) => `/workspaces/${seg(wid)}`;
const invite = (wid: string, email: string) => `${ws(wid)}/invites/${seg(normalizeEmail(email))}`;

/** Creates a workspace owned by the caller (at most 3 owned). */
export function createWorkspace(body: CreateWorkspaceBody): Promise<Workspace> {
  return apiFetch('POST', '/workspaces', body);
}

/** Owner: renames the workspace (name and/or slug). */
export function updateWorkspace(wid: string, body: UpdateWorkspaceBody): Promise<Workspace> {
  return apiFetch('PATCH', ws(wid), body);
}

/** Owner: hard-deletes the workspace and everything in it. `confirmSlug` must equal its current slug. */
export function deleteWorkspace(wid: string, confirmSlug: string): Promise<void> {
  const body: DeleteWorkspaceBody = { confirm: confirmSlug };
  return apiFetch('DELETE', ws(wid), body);
}

/** Owner: makes another member the owner; the caller becomes admin. */
export function transferOwnership(wid: string, uid: string): Promise<Workspace> {
  const body: TransferBody = { uid };
  return apiFetch('POST', `${ws(wid)}/transfer`, body);
}

/** Admin+: sets a non-owner's role. */
export function setMemberRole(wid: string, uid: string, role: InviteRole): Promise<Member> {
  const body: SetRoleBody = { role };
  return apiFetch('PATCH', `${ws(wid)}/members/${seg(uid)}`, body);
}

/** Admin+: removes a non-owner (their tokens in the workspace are revoked). With the caller's own uid: leave. */
export function removeMember(wid: string, uid: string): Promise<void> {
  return apiFetch('DELETE', `${ws(wid)}/members/${seg(uid)}`);
}

/** Leaves the workspace (not for the owner, who must transfer first). */
export function leaveWorkspace(wid: string): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return Promise.reject(new Error('Not signed in'));
  return removeMember(wid, uid);
}

/** Admin+: invites an email (default role `member`) and sends the invite email. */
export function inviteMember(wid: string, email: string, role?: InviteRole): Promise<InviteResult> {
  const body: CreateInviteBody = { email: normalizeEmail(email), ...(role && { role }) };
  return apiFetch('POST', `${ws(wid)}/invites`, body);
}

/** Admin+: sends the invite email again (at most once a minute). */
export function resendInvite(wid: string, email: string): Promise<InviteResult> {
  return apiFetch('POST', `${invite(wid, email)}/resend`);
}

/** Admin+: revokes an invite. As the invitee (own email): declines it. */
export function revokeInvite(wid: string, email: string): Promise<void> {
  return apiFetch('DELETE', invite(wid, email));
}

/** The invitee declines an invite to their own email. */
export const declineInvite = revokeInvite;

/** The invitee accepts an invite to their own email: becomes a member with the invite's role. */
export function acceptInvite(wid: string, email: string): Promise<AcceptResult> {
  return apiFetch('POST', `${invite(wid, email)}/accept`);
}

const SYNC_KEY = 'fira:account-synced';

/**
 * Refreshes name, photo and last sign-in on all of the caller's member docs, once per
 * browser session (sessionStorage flag per uid; set only after success, so a failure
 * retries on the next load). Fire-and-forget: callers handle the rejection.
 */
export async function syncAccount(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    if (sessionStorage.getItem(SYNC_KEY) === uid) return;
  } catch {
    // Storage unavailable: sync every load.
  }
  await apiFetch('POST', '/account/sync');
  try {
    sessionStorage.setItem(SYNC_KEY, uid);
  } catch {
    // Ignore.
  }
}
