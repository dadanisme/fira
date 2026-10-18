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
