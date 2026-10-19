import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Card, Column } from '@shared/types';
import { byRank, compareRank, rankAtIndex } from '@shared/rank';
import { moveCard } from '../../data/cards';
import { cx } from '../../lib/cx';
import { AddCard } from './AddCard';
import { CardTile } from './CardTile';
import { AddColumn, ColumnHeader } from './ColumnHeader';
import { columnCardCounts, useColumns, type ColumnsApi } from './columns';
import { markDragEnd } from './dragClock';
import { cardMatcher, type Filters } from './filters';
import { useBoardData, type BoardData } from './context';
import { toastError } from './toast';

type Move = { status: string; rank: string };

/** Sortable ids of columns are prefixed so they never collide with column droppables or cards. */
const COLUMN_PREFIX = 'column:';
const columnSortId = (id: string) => COLUMN_PREFIX + id;
const fromColumnSortId = (id: string) => id.slice(COLUMN_PREFIX.length);
type DragKind = 'card' | 'column' | 'container';
const kindOf = (data: { current?: Record<string, unknown> | null }) => data.current?.kind as DragKind | undefined;

/**
 * Columns are found by the pointer first, then the closest card inside that column.
 * Plain closestCorners over every droppable compares corner distances, so a tall
 * column's far bottom corners lose to cards in a neighbouring column: drops landed in
 * the wrong column (e.g. never in a middle or empty one).
 */
const collisionDetection: CollisionDetection = (args) => {
  const all = args.droppableContainers;
  if (kindOf(args.active.data) === 'column') {
    return closestCenter({ ...args, droppableContainers: all.filter((c) => kindOf(c.data) === 'column') });
  }
  const containers = all.filter((c) => kindOf(c.data) === 'container');
  const scoped = { ...args, droppableContainers: containers };
  let hits = pointerWithin(scoped);
  if (!hits.length) hits = rectIntersection(scoped);
  if (!hits.length) hits = closestCenter(scoped);
  const columnId = hits[0]?.id;
  if (columnId === undefined) return [];
  const cardsIn = all.filter((c) => kindOf(c.data) === 'card' && c.data.current?.sortable?.containerId === columnId);
  return cardsIn.length ? closestCenter({ ...args, droppableContainers: cardsIn }) : [hits[0]];
};

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
  const columnsApi = useColumns(project);
  const { columns } = columnsApi;
  const cardTotals = useMemo(() => columnCardCounts(cards), [cards]);

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
  const [columnDrag, setColumnDrag] = useState<string | null>(null);

  const containerOf = (cols: Record<string, string[]>, id: string) =>
    id in cols ? id : Object.keys(cols).find((k) => cols[k].includes(id));

  const onDragStart = ({ active }: DragStartEvent) => {
    if (kindOf(active.data) === 'column') {
      setColumnDrag(String(active.id));
      return;
    }
    const snapshot: Record<string, string[]> = {};
    for (const [col, list] of groups) snapshot[col] = list.map((c) => c.id);
    setDrag({ id: String(active.id), columns: snapshot });
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || kindOf(active.data) === 'column') return;
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
    if (kindOf(active.data) === 'column') {
      setColumnDrag(null);
      if (over) columnsApi.move(fromColumnSortId(String(active.id)), fromColumnSortId(String(over.id)));
      return;
    }
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
    setColumnDrag(null);
  };

  const activeCard = drag ? data.byId.get(drag.id) : undefined;
  const columnSortIds = useMemo(() => columns.map((c) => columnSortId(c.id)), [columns]);
  const lookup = useCallback((id: string) => effective(data, moves, id), [data, moves]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pt-1 pb-4">
        <SortableContext items={columnSortIds} strategy={horizontalListSortingStrategy}>
          {columns.map((col) => (
            <BoardColumn
              key={col.id}
              column={col}
              columnsApi={columnsApi}
              cardTotal={cardTotals.get(col.id) ?? 0}
              cards={drag ? undefined : groups.get(col.id)}
              dragIds={drag?.columns[col.id]}
              lookup={lookup}
              lastRank={lastRank.get(col.id) ?? null}
              selectedKey={selectedKey}
              onOpen={onOpen}
            />
          ))}
        </SortableContext>
        <AddColumn onAdd={columnsApi.add} />
      </div>
      {/* Columns move in place; only cards use the overlay (its drop animation would hide a column). */}
      <DragOverlay dropAnimation={columnDrag ? null : { duration: 150, easing: 'ease-out' }}>
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
  columnsApi: ColumnsApi;
  /** All cards with this status, archived included. */
  cardTotal: number;
  /** Cards when idle. */
  cards: Card[] | undefined;
  /** Ordered ids while a drag is in progress. */
  dragIds: string[] | undefined;
  lookup: (id: string) => Card;
  lastRank: string | null;
  selectedKey: string | undefined;
  onOpen: (key: string) => void;
}

const CONTAINER_DATA = { kind: 'container' } as const;
const COLUMN_DATA = { kind: 'column' } as const;
const CARD_DATA = { kind: 'card' } as const;

const BoardColumn = memo(function BoardColumn({
  column,
  columnsApi,
  cardTotal,
  cards,
  dragIds,
  lookup,
  lastRank,
  selectedKey,
  onOpen,
}: ColumnProps) {
  const ids = useMemo(() => dragIds ?? cards?.map((c) => c.id) ?? [], [dragIds, cards]);
  const list = useMemo(() => cards ?? ids.map(lookup), [cards, ids, lookup]);
  // The whole column (header included) is the drop target for cards.
  const droppable = useDroppable({ id: column.id, data: CONTAINER_DATA });
  const sortable = useSortable({ id: columnSortId(column.id), data: COLUMN_DATA });
  const setDroppableRef = droppable.setNodeRef;
  const setSortableRef = sortable.setNodeRef;
  const sectionRef = useCallback(
    (el: HTMLElement | null) => {
      setDroppableRef(el);
      setSortableRef(el);
    },
    [setDroppableRef, setSortableRef],
  );
  const id = column.id;
  const onRename = useCallback((name: string) => columnsApi.rename(id, name), [columnsApi, id]);
  const onRemove = useCallback(() => columnsApi.remove(id), [columnsApi, id]);

  return (
    <section
      ref={sectionRef}
      aria-label={column.name}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }}
      className={cx(
        'flex w-72 shrink-0 flex-col rounded-lg bg-sunken/70',
        sortable.isDragging && 'relative z-10 shadow-popover ring-1 ring-line',
      )}
    >
      <ColumnHeader
        column={column}
        visibleCount={list.length}
        cardTotal={cardTotal}
        columnCount={columnsApi.columns.length}
        onRename={onRename}
        onRemove={onRemove}
        handleRef={sortable.setActivatorNodeRef}
        handleAttributes={sortable.attributes}
        handleListeners={sortable.listeners}
      />
      <div className={cx('flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2', droppable.isOver && 'bg-hover/50')}>
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
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: card.id, data: CARD_DATA });
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
