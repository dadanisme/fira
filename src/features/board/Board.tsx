import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card, Column } from '@shared/types';
import { byRank, compareRank, rankAtIndex } from '@shared/rank';
import { moveCard } from '../../data/cards';
import { cx } from '../../lib/cx';
import { AddCard } from './AddCard';
import { CardTile } from './CardTile';
import { markDragEnd } from './dragClock';
import { cardMatcher, type Filters } from './filters';
import { useBoardData, type BoardData } from './context';
import { toastError } from './toast';

type Move = { status: string; rank: string };

export interface BoardProps {
  filters: Filters;
  selectedKey: string | undefined;
  onOpen: (key: string) => void;
}

/**
 * Kanban board. Drag and drop is optimistic: a dropped card keeps its new place via a
 * local override until the Firestore snapshot echoes the same status and rank, so the
 * card never jumps back for a frame.
 */
export function Board({ filters, selectedKey, onOpen }: BoardProps) {
  const data = useBoardData();
  const { project, cards } = data;
  const columns = project.columns;

  // ------------------------------------------------ optimistic moves
  const [moves, setMoves] = useState<ReadonlyMap<string, Move>>(new Map());
  useEffect(() => {
    if (moves.size === 0) return;
    const settled = [...moves].filter(([id, m]) => {
      const c = data.byId.get(id);
      return !c || (c.status === m.status && c.rank === m.rank);
    });
    if (settled.length) {
      setMoves((prev) => {
        const next = new Map(prev);
        settled.forEach(([id]) => next.delete(id));
        return next;
      });
    }
  }, [data.byId, moves]);

  // ------------------------------------------------ grouping
  const matcher = useMemo(() => cardMatcher(filters, project.fields, (c) => data.epicOf(c)?.key), [filters, project.fields, data]);

  const prevGroups = useRef<Map<string, Card[]>>(new Map());
  const { groups, lastRank } = useMemo(() => {
    const colIds = new Set(columns.map((c) => c.id));
    const fallback = columns[0]?.id;
    const next = new Map<string, Card[]>(columns.map((c) => [c.id, []]));
    const last = new Map<string, string>();
    for (const raw of cards) {
      const m = moves.get(raw.id);
      const card = m ? { ...raw, ...m } : raw;
      const col = colIds.has(card.status) ? card.status : fallback;
      if (!col) continue;
      const prev = last.get(col);
      if (prev === undefined || compareRank(card.rank, prev) > 0) last.set(col, card.rank);
      if (matcher(card)) next.get(col)!.push(card);
    }
    // Reuse unchanged column arrays so their memoized lists skip rendering.
    for (const [col, list] of next) {
      list.sort(byRank);
      const old = prevGroups.current.get(col);
      if (old && old.length === list.length && old.every((c, i) => c === list[i])) next.set(col, old);
    }
    prevGroups.current = next;
    return { groups: next, lastRank: last };
  }, [cards, columns, moves, matcher]);

  // ------------------------------------------------ drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );
  const [drag, setDrag] = useState<{ id: string; columns: Record<string, string[]> } | null>(null);

  const containerOf = (cols: Record<string, string[]>, id: string) =>
    id in cols ? id : Object.keys(cols).find((k) => cols[k].includes(id));

  const onDragStart = ({ active }: DragStartEvent) => {
    const snapshot: Record<string, string[]> = {};
    for (const [col, list] of groups) snapshot[col] = list.map((c) => c.id);
    setDrag({ id: String(active.id), columns: snapshot });
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setDrag((d) => {
      if (!d) return d;
      const activeId = String(active.id);
      const overId = String(over.id);
      const from = containerOf(d.columns, activeId);
      const to = containerOf(d.columns, overId);
      if (!from || !to || from === to) return d;
      const target = d.columns[to];
      let index = target.length;
      if (overId !== to) {
        const overIndex = target.indexOf(overId);
        const translated = active.rect.current.translated;
        const below = translated && translated.top > over.rect.top + over.rect.height / 2;
        index = overIndex + (below ? 1 : 0);
      }
      return {
        ...d,
        columns: {
          ...d.columns,
          [from]: d.columns[from].filter((id) => id !== activeId),
          [to]: [...target.slice(0, index), activeId, ...target.slice(index)],
        },
      };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    markDragEnd();
    const d = drag;
    setDrag(null);
    if (!d || !over) return;
    const activeId = String(active.id);
    const to = containerOf(d.columns, String(over.id));
    if (!to) return;
    let ids = d.columns[to];
    const oldIndex = ids.indexOf(activeId);
    const overIndex = ids.indexOf(String(over.id));
    if (overIndex >= 0 && oldIndex !== overIndex) ids = arrayMove(ids, oldIndex, overIndex);
    const index = ids.indexOf(activeId);
    const card = data.byId.get(activeId);
    if (!card || index < 0) return;

    const current = moves.get(card.id) ?? { status: card.status, rank: card.rank };
    const neighbours = ids.filter((id) => id !== activeId).map((id) => effective(data, moves, id));
    const before = neighbours[index - 1];
    const after = neighbours[index];
    if (
      current.status === to &&
      (!before || compareRank(before.rank, current.rank) < 0) &&
      (!after || compareRank(current.rank, after.rank) < 0)
    ) {
      return; // Already in place.
    }
    let rank: string;
    try {
      rank = rankAtIndex(neighbours, index);
    } catch {
      rank = rankAtIndex(neighbours.slice(0, index), index); // Duplicate neighbour ranks: append after `before`.
    }
    const move = { status: to, rank };
    setMoves((prev) => new Map(prev).set(card.id, move));
    const revert = (err: unknown) => {
      toastError(err);
      setMoves((prev) => {
        const next = new Map(prev);
        next.delete(card.id);
        return next;
      });
    };
    try {
      moveCard(card, to, rank, data.ctx).catch(revert);
    } catch (err) {
      revert(err);
    }
  };

  const onDragCancel = () => {
    markDragEnd();
    setDrag(null);
  };

  const activeCard = drag ? data.byId.get(drag.id) : undefined;
  const lookup = useCallback((id: string) => effective(data, moves, id), [data, moves]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pt-1 pb-4">
        {columns.map((col) => (
          <BoardColumn
            key={col.id}
            column={col}
            cards={drag ? undefined : groups.get(col.id)}
            dragIds={drag?.columns[col.id]}
            lookup={lookup}
            lastRank={lastRank.get(col.id) ?? null}
            selectedKey={selectedKey}
            onOpen={onOpen}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 150, easing: 'ease-out' }}>
        {activeCard && <Tile card={activeCard} overlay onOpen={onOpen} />}
      </DragOverlay>
    </DndContext>
  );
}

function effective(data: BoardData, moves: ReadonlyMap<string, Move>, id: string): Card {
  const c = data.byId.get(id)!;
  const m = moves.get(id);
  return m ? { ...c, ...m } : c;
}

// ------------------------------------------------------------- column

interface ColumnProps {
  column: Column;
  /** Cards when idle. */
  cards: Card[] | undefined;
  /** Ordered ids while a drag is in progress. */
  dragIds: string[] | undefined;
  lookup: (id: string) => Card;
  lastRank: string | null;
  selectedKey: string | undefined;
  onOpen: (key: string) => void;
}

const BoardColumn = memo(function BoardColumn({ column, cards, dragIds, lookup, lastRank, selectedKey, onOpen }: ColumnProps) {
  const ids = useMemo(() => dragIds ?? cards?.map((c) => c.id) ?? [], [dragIds, cards]);
  const list = useMemo(() => cards ?? ids.map(lookup), [cards, ids, lookup]);
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <section aria-label={column.name} className="flex w-72 shrink-0 flex-col rounded-lg bg-sunken/70">
      <header className="flex h-9 shrink-0 items-center gap-2 px-3 text-[12px] font-medium text-fg-muted">
        <span className="truncate">{column.name}</span>
        <span className="text-fg-faint tabular-nums">{list.length}</span>
      </header>
      <div ref={setNodeRef} className={cx('flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2', isOver && 'bg-hover/50')}>
        <SortableContext id={column.id} items={ids} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1.5">
            {list.map((card) => (
              <SortableTile key={card.id} card={card} selected={card.key === selectedKey} onOpen={onOpen} />
            ))}
          </div>
        </SortableContext>
        <AddCard columnId={column.id} lastRank={lastRank} visibleIds={ids} />
      </div>
    </section>
  );
});

const SortableTile = memo(function SortableTile({ card, selected, onOpen }: { card: Card; selected: boolean; onOpen: (key: string) => void }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: card.id });
  const t = CSS.Translate.toString(transform);
  const style = useMemo(() => ({ transform: t, transition }), [t, transition]);
  return (
    <Tile
      card={card}
      selected={selected}
      onOpen={onOpen}
      dragRef={setNodeRef}
      dragAttributes={attributes}
      dragListeners={listeners}
      dragStyle={style}
      ghost={isDragging}
    />
  );
});

type TileProps = Omit<Parameters<typeof CardTile>[0], 'projectKey' | 'epic' | 'parentKey' | 'done' | 'progressDone' | 'progressTotal'>;

/** Resolves the tile's derived props (epic, parent, progress) into primitives so CardTile's memo holds. */
function Tile(props: TileProps) {
  const data = useBoardData();
  const { card } = props;
  const epic = card.type === 'epic' ? undefined : data.epicOf(card);
  const parent = card.type === 'subtask' && card.parentId ? data.byId.get(card.parentId) : undefined;
  let progressDone = 0;
  let progressTotal = 0;
  for (const child of data.childrenOf.get(card.id) ?? []) {
    if (child.archived) continue;
    progressTotal++;
    if (child.status === data.doneId) progressDone++;
  }
  const epicId = epic?.id;
  const epicTitle = epic?.title;
  const epicProp = useMemo(() => (epicId ? { id: epicId, title: epicTitle ?? '' } : undefined), [epicId, epicTitle]);
  return (
    <CardTile
      {...props}
      projectKey={data.project.key}
      epic={epicProp}
      parentKey={parent?.key}
      done={card.status === data.doneId}
      progressDone={progressDone}
      progressTotal={progressTotal}
    />
  );
}
