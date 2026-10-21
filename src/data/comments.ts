import { orderBy, query, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore';
import { useMemo } from 'react';
import type { Comment } from '@shared/types';
import { db } from '../lib/firebase';
import { currentActor } from './actor';
import { commentsCol, newDoc, rawDoc, type Stored } from './db';
import { useLiveQuery, type Live } from './live';
import { writeActivity } from './writes';
import { useWorkspaceId } from './workspace';

/** Comments of a card, oldest first. */
export function useComments(cardId: string | undefined): Live<Comment[]> {
  const wid = useWorkspaceId();
  const q = useMemo(() => (cardId ? query(commentsCol(cardId, wid), orderBy('createdAt')) : null), [cardId, wid]);
  return useLiveQuery(q);
}

/** Adds a Markdown comment plus a `comment` activity entry (to = comment id). */
export function addComment(cardId: string, body: string): Promise<void> {
  const actor = currentActor();
  const ref = newDoc('cards', cardId, 'comments');
  const comment: Stored<Comment, 'createdAt'> = { body, author: actor, createdAt: serverTimestamp() };
  const batch = writeBatch(db);
  batch.set(ref, comment);
  writeActivity(batch, cardId, [{ kind: 'comment', to: ref.id }], actor);
  return batch.commit();
}

export function updateComment(cardId: string, commentId: string, body: string): Promise<void> {
  return updateDoc(rawDoc('cards', cardId, 'comments', commentId), { body, updatedAt: serverTimestamp() });
}

/** Deletes a comment and logs it (`comment` entry with from = comment id). */
export function deleteComment(cardId: string, commentId: string): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(rawDoc('cards', cardId, 'comments', commentId));
  writeActivity(batch, cardId, [{ kind: 'comment', from: commentId, to: null }], currentActor());
  return batch.commit();
}
