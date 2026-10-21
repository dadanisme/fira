import {
  collection,
  collectionGroup,
  doc,
  query,
  Timestamp,
  where,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type FieldValue,
  type FirestoreDataConverter,
  type Query,
} from 'firebase/firestore';
import type {
  Activity,
  Attachment,
  Card,
  Comment,
  Invite,
  Label,
  Member,
  Membership,
  Page,
  PageVersion,
  Project,
  Thread,
  Workspace,
} from '@shared/types';
import { normalizeEmail } from '@shared/actors';
import { db } from '../lib/firebase';
import { currentWorkspaceId } from './workspace';

/**
 * Typed collection references for reads. Converters add `id` and turn every
 * Firestore Timestamp (pending server timestamps included, as estimates) into an
 * ISO string, matching shared/types.ts.
 *
 * Everything lives under `workspaces/{wid}`. Content collections take the workspace id;
 * it defaults to the active one (for mutations), hooks pass `useWorkspaceId()`.
 *
 * Writes go through `rawDoc` / `newDoc` with `Stored<T>` shapes, because written
 * timestamps are `serverTimestamp()` sentinels rather than strings.
 */

function toIso(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(toIso);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toIso(v)]));
  }
  return value;
}

function converter<T extends { id: string }>(): FirestoreDataConverter<T, DocumentData> {
  return {
    toFirestore: (data) => data as DocumentData,
    fromFirestore: (snap) => ({ ...(toIso(snap.data({ serverTimestamps: 'estimate' })) as object), id: snap.id }) as T,
  };
}

function typed<T extends { id: string }>(ref: CollectionReference): CollectionReference<T, DocumentData> {
  return ref.withConverter(converter<T>());
}

/** `workspaces/{wid}/<path>/<segments...>` as a collection reference. */
export function colIn(wid: string, path: string, ...segments: string[]): CollectionReference {
  return collection(db, 'workspaces', wid, path, ...segments);
}

/** `workspaces/{wid}/<path>/<segments...>` as a document reference. */
export function docIn(wid: string, path: string, ...segments: string[]): DocumentReference {
  return doc(db, 'workspaces', wid, path, ...segments);
}

/** A new document reference with an auto id in `workspaces/{wid}/<path>/<segments...>`. */
export function newDocIn(wid: string, path: string, ...segments: string[]): DocumentReference {
  return doc(colIn(wid, path, ...segments));
}

export const projectsCol = (wid = currentWorkspaceId()) => typed<Project>(colIn(wid, 'projects'));
export const labelsCol = (wid = currentWorkspaceId()) => typed<Label>(colIn(wid, 'labels'));
export const cardsCol = (wid = currentWorkspaceId()) => typed<Card>(colIn(wid, 'cards'));
export const pagesCol = (wid = currentWorkspaceId()) => typed<Page>(colIn(wid, 'pages'));

export const commentsCol = (cardId: string, wid = currentWorkspaceId()) => typed<Comment>(colIn(wid, 'cards', cardId, 'comments'));
export const activityCol = (cardId: string, wid = currentWorkspaceId()) => typed<Activity>(colIn(wid, 'cards', cardId, 'activity'));
export const attachmentsCol = (cardId: string, wid = currentWorkspaceId()) =>
  typed<Attachment>(colIn(wid, 'cards', cardId, 'attachments'));
export const versionsCol = (pageId: string, wid = currentWorkspaceId()) => typed<PageVersion>(colIn(wid, 'pages', pageId, 'versions'));
export const threadsCol = (pageId: string, wid = currentWorkspaceId()) => typed<Thread>(colIn(wid, 'pages', pageId, 'threads'));

/** Members and invites are written only by the API; clients read them. */
export const membersCol = (wid: string) => typed<Member>(colIn(wid, 'members'));
export const invitesCol = (wid: string) => typed<Invite>(colIn(wid, 'invites'));
export const workspaceDoc = (wid: string) => doc(typed<Workspace>(collection(db, 'workspaces')), wid);

/**
 * Whether a collection-group result sits exactly at `workspaces/{wid}/<coll>/{id}`. The
 * rules only allow content collections under a workspace, but the "my workspaces" / "my
 * invites" queries skip anything else anyway, so a doc planted elsewhere can never pose as
 * a membership or invite.
 */
export function isWorkspaceChild(ref: DocumentReference, coll: 'members' | 'invites'): boolean {
  const parts = ref.path.split('/');
  return parts.length === 4 && parts[0] === 'workspaces' && parts[2] === coll;
}

/**
 * Converter for collection-group results that sit at `workspaces/{wid}/<coll>/{id}`: sets
 * `workspaceId` from the path (never from the data), or to '' when the doc sits anywhere
 * else, so the hooks can drop it.
 */
function groupConverter<T extends { id: string; workspaceId: string }>(coll: 'members' | 'invites'): FirestoreDataConverter<T, DocumentData> {
  return {
    toFirestore: (data) => data as DocumentData,
    fromFirestore: (snap) =>
      ({
        ...(toIso(snap.data({ serverTimestamps: 'estimate' })) as object),
        id: snap.id,
        workspaceId: isWorkspaceChild(snap.ref, coll) ? snap.ref.parent.parent!.id : '',
      }) as T,
  };
}

/** "My workspaces": every member doc with my uid (collection group). Drop results whose `workspaceId` is ''. */
export const myMembershipsQuery = (uid: string): Query<Membership, DocumentData> =>
  query(collectionGroup(db, 'members').withConverter(groupConverter<Membership>('members')), where('uid', '==', uid));

/** "My invites": every invite to my (lowercased) email (collection group). Drop results whose `workspaceId` is ''. */
export const myInvitesQuery = (email: string): Query<Invite, DocumentData> =>
  query(collectionGroup(db, 'invites').withConverter(groupConverter<Invite>('invites')), where('email', '==', normalizeEmail(email)));

/** Untyped reference for writes in the active workspace: `rawDoc('cards', id)` → `workspaces/{wid}/cards/{id}`. */
export function rawDoc(path: string, ...segments: string[]): DocumentReference {
  return docIn(currentWorkspaceId(), path, ...segments);
}

/** A new document reference with an auto id in the given collection path of the active workspace. */
export function newDoc(path: string, ...segments: string[]): DocumentReference {
  return newDocIn(currentWorkspaceId(), path, ...segments);
}

/** Stored shape of `T` for writes: no `id`, and timestamp keys `K` accept sentinels/Timestamps. */
export type Stored<T, K extends keyof T = never> = Omit<T, 'id' | K> & { [P in K]: FieldValue | Timestamp };
