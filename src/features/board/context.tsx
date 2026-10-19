import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { Card, Label, Project } from '@shared/types';
import type { ActivityContext, CardPatch } from '@shared/activity';
import { byRank } from '@shared/rank';
import { doneColumn } from '@shared/status';
import { updateCard } from '../../data/cards';
import { toastError } from './toast';

/** Everything the board and the card dialog derive from the project's card list. */
export interface BoardData {
  project: Project;
  cards: readonly Card[];
  byId: ReadonlyMap<string, Card>;
  byKey: ReadonlyMap<string, Card>;
  /** Children of an epic (cards) or a card (subtasks), rank order, archived included. */
  childrenOf: ReadonlyMap<string, Card[]>;
  /** Non-archived epics, rank order. */
  epics: Card[];
  labels: readonly Label[];
  doneId: string | undefined;
  ctx: ActivityContext;
  /** Key of the epic a card belongs to (subtasks inherit their parent's epic). */
  epicOf(card: Card): Card | undefined;
}

const Ctx = createContext<BoardData | null>(null);

export function useBoardData(): BoardData {
  const data = useContext(Ctx);
  if (!data) throw new Error('useBoardData must be used inside BoardDataProvider');
  return data;
}

export function BoardDataProvider({
  project,
  cards,
  labels,
  children,
}: {
  project: Project;
  cards: readonly Card[];
  labels: readonly Label[];
  children: ReactNode;
}) {
  const value = useMemo<BoardData>(() => {
    const byId = new Map(cards.map((c) => [c.id, c]));
    const byKey = new Map(cards.map((c) => [c.key, c]));
    const childrenOf = new Map<string, Card[]>();
    for (const c of cards) {
      if (c.parentId) {
        const list = childrenOf.get(c.parentId);
        if (list) list.push(c);
        else childrenOf.set(c.parentId, [c]);
      }
    }
    for (const list of childrenOf.values()) list.sort(byRank);
    const epics = cards.filter((c) => c.type === 'epic' && !c.archived).sort(byRank);
    const epicOf = (card: Card): Card | undefined => {
      const parent = card.parentId ? byId.get(card.parentId) : undefined;
      if (!parent) return undefined;
      if (parent.type === 'epic') return parent;
      const grand = parent.parentId ? byId.get(parent.parentId) : undefined;
      return grand?.type === 'epic' ? grand : undefined;
    };
    return {
      project,
      cards,
      byId,
      byKey,
      childrenOf,
      epics,
      labels,
      doneId: doneColumn(project.columns)?.id,
      ctx: { columns: project.columns, cardKey: (id) => byId.get(id)?.key },
      epicOf,
    };
  }, [project, cards, labels]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Optimistic card update with activity; failures surface as toasts. */
export function patchCard(data: BoardData, card: Card, patch: CardPatch) {
  run(() => updateCard(card, patch, data.ctx));
}

/** Runs a mutation without awaiting it; sync throws and rejections become toasts. */
export function run(fn: () => Promise<unknown> | unknown) {
  try {
    const result = fn();
    if (result instanceof Promise) result.catch(toastError);
  } catch (err) {
    toastError(err);
  }
}
