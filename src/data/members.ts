import { query } from 'firebase/firestore';
import { useMemo } from 'react';
import type { Invite, Member, Membership } from '@shared/types';
import { ROLE_RANK } from '@shared/workspaces';
import { invitesCol, membersCol, myInvitesQuery, myMembershipsQuery } from './db';
import { useLiveQuery, useLiveQuerySynced, type Live, type LiveSynced } from './live';
import { useWorkspaceId } from './workspace';

/**
 * Members and invites are read live from Firestore and changed only through the API
 * (src/data/workspaces.ts).
 */

/** Members of the active workspace: the owner, then admins, then members, each by name. */
export function useMembers(): Live<Member[]> {
  const wid = useWorkspaceId();
  const q = useMemo(() => query(membersCol(wid)), [wid]);
  const live = useLiveQuery(q);
  const data = useMemo(
    () =>
      [...live.data].sort(
        (a, b) => ROLE_RANK[b.role] - ROLE_RANK[a.role] || (a.name || a.email).localeCompare(b.name || b.email),
      ),
    [live.data],
  );
  return { ...live, data };
}

/** Pending invites of the active workspace, newest first. */
export function useInvites(): Live<Invite[]> {
  const wid = useWorkspaceId();
  const q = useMemo(() => query(invitesCol(wid)), [wid]);
  const live = useLiveQuery(q);
  const data = useMemo(() => [...live.data].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')), [live.data]);
  return { ...live, data };
}

/**
 * The signed-in user's workspaces (one collection-group query over member docs), sorted by
 * workspace name. `loading` stays true while the cache has nothing yet; `fromCache` says the
 * list may still miss a just-joined workspace.
 */
export function useMyMemberships(uid: string): LiveSynced<Membership[]> {
  const q = useMemo(() => myMembershipsQuery(uid), [uid]);
  const live = useLiveQuerySynced(q);
  const data = useMemo(
    () =>
      live.data
        .filter((m) => m.workspaceId !== '')
        .sort((a, b) => a.workspaceName.localeCompare(b.workspaceName) || a.workspaceSlug.localeCompare(b.workspaceSlug)),
    [live.data],
  );
  return { ...live, data };
}

/** Pending invites to the signed-in user's email, across workspaces, newest first. */
export function useMyInvites(email: string): LiveSynced<Invite[]> {
  const q = useMemo(() => myInvitesQuery(email), [email]);
  const live = useLiveQuerySynced(q);
  const data = useMemo(
    () =>
      live.data
        .filter((i) => i.workspaceId !== '')
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    [live.data],
  );
  return { ...live, data };
}
