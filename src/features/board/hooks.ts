import { useEffect, useMemo, useRef, useState } from 'react';

/** Deep equality for JSON-like values (Firestore documents after conversion). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/**
 * Structural sharing for snapshot lists: every snapshot builds new objects for every
 * document, so unchanged items are swapped back to their previous instance. Memoized
 * children then re-render only for documents that actually changed.
 */
export function useStableList<T extends { id: string }>(list: T[]): T[] {
  const prev = useRef<{ byId: Map<string, T>; list: T[] }>({ byId: new Map(), list: [] });
  return useMemo(() => {
    const { byId, list: prevList } = prev.current;
    const nextById = new Map<string, T>();
    let unchanged = list.length === prevList.length;
    const out = list.map((item, i) => {
      const old = byId.get(item.id);
      const kept = old && deepEqual(old, item) ? old : item;
      if (kept !== prevList[i]) unchanged = false;
      nextById.set(item.id, kept);
      return kept;
    });
    const result = unchanged ? prevList : out;
    prev.current = { byId: nextById, list: result };
    return result;
  }, [list]);
}

/** True only once `flag` has been true for `ms` (avoids flashing spinners for cache-fast loads). */
export function useDelayedFlag(flag: boolean, ms = 200): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!flag) {
      setLate(false);
      return;
    }
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [flag, ms]);
  return flag && late;
}

/** A ref that always holds the latest value (for callbacks that must not re-subscribe). */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}
