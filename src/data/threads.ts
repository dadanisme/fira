import { arrayUnion, deleteField, query, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { useMemo } from 'react';
import type { Thread, ThreadMessage } from '@shared/types';
import { randomId } from '@shared/ids';
import { currentActor } from './actor';
import { newDoc, rawDoc, threadsCol, type Stored } from './db';
import { useLiveQuery, type Live } from './live';

/** Inline comment threads of a page (resolved included), unsorted. */
export function useThreads(pageId: string | undefined): Live<Thread[]> {
  const q = useMemo(() => (pageId ? query(threadsCol(pageId)) : null), [pageId]);
  return useLiveQuery(q);
}

export interface NewThread {
  quote: string;
  /** ≤ 32 chars before/after the quote, for re-anchoring. */
  prefix: string;
  suffix: string;
  /** First message (Markdown). */
  body: string;
}

/** Creates a thread with its first message; returns its id immediately. */
export function createThread(pageId: string, input: NewThread): string {
  const ref = newDoc('pages', pageId, 'threads');
  const thread: Omit<Stored<Thread, 'createdAt'>, 'messages'> & { messages: StoredMessage[] } = {
    quote: input.quote,
    prefix: input.prefix.slice(-32),
    suffix: input.suffix.slice(0, 32),
    resolved: false,
    messages: [message(input.body)],
    createdAt: serverTimestamp(),
  };
  setDoc(ref, thread).catch(reportError);
  return ref.id;
}

export function replyToThread(pageId: string, threadId: string, body: string): Promise<void> {
  return updateDoc(rawDoc('pages', pageId, 'threads', threadId), { messages: arrayUnion(message(body)) });
}

export function setThreadResolved(pageId: string, threadId: string, resolved: boolean): Promise<void> {
  return updateDoc(rawDoc('pages', pageId, 'threads', threadId), {
    resolved,
    resolvedAt: resolved ? serverTimestamp() : deleteField(),
  });
}

/** Messages live in an array, where server timestamps are not allowed: stamp with client time. */
type StoredMessage = Stored<ThreadMessage, 'createdAt'> & { id: string };

function message(body: string): StoredMessage {
  return { id: randomId(), body, author: currentActor(), createdAt: Timestamp.now() };
}
