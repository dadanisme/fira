import { onSnapshot, type DocumentReference, type Query } from 'firebase/firestore';
import { useEffect, useState } from 'react';

/** Result of a live subscription. `loading` is true until the first snapshot (usually from the local cache). */
export interface Live<T> {
  data: T;
  loading: boolean;
  error: Error | null;
}

const EMPTY: never[] = [];

/**
 * Subscribes to a query with onSnapshot. Pass a memoized query (or null to skip):
 * a new query object resubscribes.
 */
export function useLiveQuery<T>(q: Query<T> | null): Live<T[]> {
  const [state, setState] = useState<{ q: Query<T> | null; data: T[]; error: Error | null }>({ q: null, data: EMPTY, error: null });

  useEffect(() => {
    if (!q) return;
    return onSnapshot(
      q,
      (snap) => setState({ q, data: snap.docs.map((d) => d.data()), error: null }),
      (error) => setState({ q, data: EMPTY, error }),
    );
  }, [q]);

  const current = q !== null && state.q === q;
  return { data: current ? state.data : EMPTY, loading: q !== null && !current, error: current ? state.error : null };
}

/** Subscribes to one document; `data` is null when it does not exist. Pass a memoized ref (or null). */
export function useLiveDoc<T>(ref: DocumentReference<T> | null): Live<T | null> {
  const [state, setState] = useState<{ ref: DocumentReference<T> | null; data: T | null; error: Error | null }>({
    ref: null,
    data: null,
    error: null,
  });

  useEffect(() => {
    if (!ref) return;
    return onSnapshot(
      ref,
      (snap) => setState({ ref, data: snap.data() ?? null, error: null }),
      (error) => setState({ ref, data: null, error }),
    );
  }, [ref]);

  const current = ref !== null && state.ref === ref;
  return { data: current ? state.data : null, loading: ref !== null && !current, error: current ? state.error : null };
}

/** A live query result plus whether it came from the local cache (it may still be missing server-side changes). */
export type LiveSynced<T> = Live<T> & { fromCache: boolean };

/**
 * Like useLiveQuery, but also reports `fromCache`, and keeps `loading` true while the only
 * result is an empty snapshot from the cache (a query the cache has never seen answers
 * "nothing" first). Use it where "no results" leads somewhere, e.g. "Workspace not found".
 */
export function useLiveQuerySynced<T>(q: Query<T> | null): LiveSynced<T[]> {
  const [state, setState] = useState<{ q: Query<T> | null; data: T[]; fromCache: boolean; error: Error | null }>({
    q: null,
    data: EMPTY,
    fromCache: true,
    error: null,
  });

  useEffect(() => {
    if (!q) return;
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) => setState({ q, data: snap.docs.map((d) => d.data()), fromCache: snap.metadata.fromCache, error: null }),
      (error) => setState({ q, data: EMPTY, fromCache: false, error }),
    );
  }, [q]);

  const current = q !== null && state.q === q;
  const waiting = current && state.fromCache && state.data.length === 0 && !state.error;
  return {
    data: current ? state.data : EMPTY,
    loading: q !== null && (!current || waiting),
    error: current ? state.error : null,
    fromCache: current ? state.fromCache : true,
  };
}
