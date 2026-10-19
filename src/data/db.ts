import {
  collection,
  doc,
  Timestamp,
  type CollectionReference,
  type DocumentData,
  type DocumentReference,
  type FieldValue,
  type FirestoreDataConverter,
} from 'firebase/firestore';
import type { Activity, Attachment, Card, Comment, Label, Member, Page, PageVersion, Project, Thread } from '@shared/types';
import { db } from '../lib/firebase';

/**
 * Typed collection references for reads. Converters add `id` and turn every
 * Firestore Timestamp (pending server timestamps included, as estimates) into an
 * ISO string, matching shared/types.ts.
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

export const projectsCol = typed<Project>(collection(db, 'projects'));
export const labelsCol = typed<Label>(collection(db, 'labels'));
export const cardsCol = typed<Card>(collection(db, 'cards'));
export const pagesCol = typed<Page>(collection(db, 'pages'));
export const membersCol = typed<Member>(collection(db, 'members'));

export const commentsCol = (cardId: string) => typed<Comment>(collection(db, 'cards', cardId, 'comments'));
export const activityCol = (cardId: string) => typed<Activity>(collection(db, 'cards', cardId, 'activity'));
export const attachmentsCol = (cardId: string) => typed<Attachment>(collection(db, 'cards', cardId, 'attachments'));
export const versionsCol = (pageId: string) => typed<PageVersion>(collection(db, 'pages', pageId, 'versions'));
export const threadsCol = (pageId: string) => typed<Thread>(collection(db, 'pages', pageId, 'threads'));

/** Untyped reference for writes, e.g. `rawDoc('cards', id)` or `rawDoc('cards', id, 'comments', cid)`. */
export function rawDoc(path: string, ...segments: string[]): DocumentReference {
  return doc(db, path, ...segments);
}

/** A new document reference with an auto id in the given collection path. */
export function newDoc(path: string, ...segments: string[]): DocumentReference {
  return doc(collection(db, path, ...segments));
}

/** Stored shape of `T` for writes: no `id`, and timestamp keys `K` accept sentinels/Timestamps. */
export type Stored<T, K extends keyof T = never> = Omit<T, 'id' | K> & { [P in K]: FieldValue | Timestamp };
