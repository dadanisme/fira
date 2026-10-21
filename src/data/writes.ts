import { serverTimestamp, writeBatch, type DocumentData, type DocumentReference, type WriteBatch } from 'firebase/firestore';
import type { Activity, ActivityDraft, Actor } from '@shared/types';
import { db } from '../lib/firebase';
import { newDocIn, type Stored } from './db';
import { currentWorkspaceId } from './workspace';

/** Anything that can `set` in a batch or transaction. */
interface Writer {
  set(ref: DocumentReference, data: DocumentData): unknown;
}

/**
 * Adds activity entries for a card to the same batch/transaction as the change itself.
 * `wid` defaults to the active workspace; pass it when the mutation captured it before an await.
 */
export function writeActivity(w: Writer, cardId: string, drafts: readonly ActivityDraft[], actor: Actor, wid = currentWorkspaceId()) {
  for (const draft of drafts) {
    const entry: Stored<Activity, 'at'> = { ...draft, actor, at: serverTimestamp() };
    w.set(newDocIn(wid, 'cards', cardId, 'activity'), entry);
  }
}

const MAX_BATCH_WRITES = 450;

/** Commits writes split over as many batches as needed (Firestore caps a batch at 500 writes). */
export async function commitInChunks(writes: readonly ((batch: WriteBatch) => void)[], perWrite = 1) {
  const size = Math.max(1, Math.floor(MAX_BATCH_WRITES / perWrite));
  const commits: Promise<void>[] = [];
  for (let i = 0; i < writes.length; i += size) {
    const batch = writeBatch(db);
    writes.slice(i, i + size).forEach((write) => write(batch));
    commits.push(batch.commit());
  }
  await Promise.all(commits);
}
