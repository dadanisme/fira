import { orderBy, query } from 'firebase/firestore';
import { useMemo } from 'react';
import type { Activity } from '@shared/types';
import { activityCol } from './db';
import { useLiveQuery, type Live } from './live';

/** Activity timeline of a card, oldest first. Entries are written by the mutations (see writes.ts). */
export function useActivity(cardId: string | undefined): Live<Activity[]> {
  const q = useMemo(() => (cardId ? query(activityCol(cardId), orderBy('at')) : null), [cardId]);
  return useLiveQuery(q);
}
