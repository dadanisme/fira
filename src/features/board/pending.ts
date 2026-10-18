import { useEffect, useRef, useState } from 'react';
import { compareRank, rankBetween } from '@shared/rank';
import { toastError } from './toast';

interface Pending {
  tempId: number;
  title: string;
  /** Set once created; the ghost stays until the real card shows up (no flicker). */
  id?: string;
}

/**
 * Creation needs a transaction (card numbers), so new cards render as ghosts until
 * the snapshot delivers them. Ranks are allocated locally, so rapid entries keep order.
 */
export function usePendingCards(visibleIds: readonly string[]) {
  const [pending, setPending] = useState<Pending[]>([]);
  const nextTemp = useRef(1);

  useEffect(() => {
    if (!pending.some((p) => p.id && visibleIds.includes(p.id))) return;
    setPending((list) => list.filter((p) => !(p.id && visibleIds.includes(p.id))));
  }, [visibleIds, pending]);

  const track = (title: string, create: () => Promise<{ id: string }>) => {
    const tempId = nextTemp.current++;
    setPending((list) => [...list, { tempId, title }]);
    const drop = () => setPending((list) => list.filter((p) => p.tempId !== tempId));
    let promise: Promise<{ id: string }>;
    try {
      promise = create();
    } catch (err) {
      toastError(err);
      drop();
      return;
    }
    promise.then(
      ({ id }) => {
        setPending((list) => list.map((p) => (p.tempId === tempId ? { ...p, id } : p)));
        // Filtered out of view: don't wait forever for it to appear.
        setTimeout(drop, 2000);
      },
      (err) => {
        toastError(err);
        drop();
      },
    );
  };

  return { pending, track };
}

/** Allocates increasing ranks after `lastRank`, also after ranks handed out but not yet echoed. */
export function useRankAllocator(lastRank: string | null) {
  const handedOut = useRef<string | null>(null);
  return () => {
    const base = handedOut.current && (!lastRank || compareRank(handedOut.current, lastRank) > 0) ? handedOut.current : lastRank;
    const rank = rankBetween(base, null);
    handedOut.current = rank;
    return rank;
  };
}
