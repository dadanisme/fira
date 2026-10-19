import { FirebaseError } from 'firebase/app';
import type { User } from 'firebase/auth';
import { deleteDoc, getDoc, onSnapshot, query, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { useMemo } from 'react';
import type { Member } from '@shared/types';
import { normalizeEmail } from '@shared/actors';
import { membersCol, rawDoc } from './db';
import { useLiveQuery, type Live } from './live';

const allMembers = query(membersCol);

/** Everyone who may use fira: the owner first, then by name (or email). */
export function useMembers(): Live<Member[]> {
  const live = useLiveQuery(allMembers);
  const data = useMemo(
    () =>
      [...live.data].sort(
        (a, b) => Number(b.role === 'owner') - Number(a.role === 'owner') || (a.name ?? a.email).localeCompare(b.name ?? b.email),
      ),
    [live.data],
  );
  return { ...live, data };
}

/** Owner only (enforced by the rules): invites a Google account by email. */
export function addMember(email: string, addedBy: string): Promise<void> {
  const id = normalizeEmail(email);
  return setDoc(rawDoc('members', id), { email: id, role: 'member', addedAt: serverTimestamp(), addedBy: normalizeEmail(addedBy) });
}

/** Owner only: removes a member. Their access (app, rules, API tokens) ends immediately. */
export function removeMember(email: string): Promise<void> {
  return deleteDoc(rawDoc('members', normalizeEmail(email)));
}

/**
 * Watches whether `email` is on the invite list. Calls `onChange(true)` once the member doc
 * exists (possibly from the local cache, for an instant start) and `onChange(false)` when the
 * server says it doesn't, or the rules deny reading it (not a member). Returns an unsubscribe.
 */
export function watchMembership(email: string, onChange: (member: boolean) => void): () => void {
  return onSnapshot(
    rawDoc('members', normalizeEmail(email)),
    (snap) => {
      if (snap.exists()) onChange(true);
      else if (!snap.metadata.fromCache) onChange(false);
    },
    (err) => {
      if (!(err instanceof FirebaseError) || err.code !== 'permission-denied') reportError(err);
      onChange(false);
    },
  );
}

/**
 * Records the signed-in user's profile (uid, name, photo, last sign-in) on their member doc.
 * The owner's doc is created on first sign-in with role `owner`; members can only update theirs.
 */
export async function recordSignIn(user: User, isOwner: boolean): Promise<void> {
  if (!user.email) return;
  const id = normalizeEmail(user.email);
  const signedIn = user.metadata.lastSignInTime ? new Date(user.metadata.lastSignInTime) : new Date();
  const profile = {
    uid: user.uid,
    name: user.displayName ?? undefined,
    photoURL: user.photoURL ?? undefined,
    lastSignInAt: Timestamp.fromDate(signedIn),
  };
  const ref = rawDoc('members', id);
  if (isOwner && !(await getDoc(ref)).exists()) {
    await setDoc(ref, { email: id, role: 'owner', addedAt: serverTimestamp(), addedBy: id, ...profile });
  } else {
    await updateDoc(ref, profile);
  }
}
