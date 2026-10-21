import { orderBy, query } from 'firebase/firestore';
import { useMemo } from 'react';
import type { Activity } from '@shared/types';
import { activityCol } from './db';
import { useLiveQuery, type Live } from './live';
import { useWorkspaceId } from './workspace';

/** Activity timeline of a card, oldest first. Entries are written by the mutations (see writes.ts). */
export function useActivity(cardId: string | undefined): Live<Activity[]> {
  const wid = useWorkspaceId();
  const q = useMemo(() => (cardId ? query(activityCol(cardId, wid), orderBy('at')) : null), [cardId, wid]);
  return useLiveQuery(q);
}
