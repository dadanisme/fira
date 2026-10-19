import { memo, type CSSProperties, type MouseEvent, type Ref } from 'react';
import { Archive, Calendar, CornerDownRight } from 'lucide-react';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import type { Card } from '@shared/types';
import { cx } from '../../lib/cx';
import { justDragged } from './dragClock';
import { formatDate, today } from './format';
import { EpicTag, LabelBadges, PriorityIcon, ProgressBadge, TypeIcon } from './ui';

export interface CardTileProps {
  card: Card;
  projectKey: string;
  epic?: { id: string; title: string };
  /** Key of the parent card (subtasks). */
  parentKey?: string;
  done: boolean;
  progressDone: number;
  progressTotal: number;
  selected?: boolean;
  onOpen?: (key: string) => void;
  /** Drag wiring (from useSortable). */
  dragRef?: Ref<HTMLAnchorElement>;
  dragStyle?: CSSProperties;
  dragAttributes?: DraggableAttributes;
  dragListeners?: DraggableSyntheticListeners;
  /** Placeholder left in the list while this card is dragged. */
  ghost?: boolean;
  /** Rendered in the drag overlay. */
  overlay?: boolean;
}

/** Compact board card. Memoized: re-renders only when its own data changes. */
export const CardTile = memo(function CardTile({
  card,
  projectKey,
  epic,
  parentKey,
  done,
  progressDone,
  progressTotal,
  selected,
  onOpen,
  dragRef,
  dragStyle,
  dragAttributes,
  dragListeners,
  ghost,
  overlay,
}: CardTileProps) {
  const due = card.dueDate;
  const now = due ? today() : '';
  const overdue = due && !done && due < now;
  const dueToday = due && !done && due === now;

  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (justDragged()) return;
    onOpen?.(card.key);
  };

  // dnd-kit's role="button" would hide the link semantics; keep the anchor's.
  const { role: _role, ...attributes } = dragAttributes ?? ({} as Partial<DraggableAttributes>);

  return (
    <a
      ref={dragRef}
      href={`/p/${projectKey}/${card.key}`}
      onClick={onClick}
      style={dragStyle}
      {...attributes}
      {...dragListeners}
      aria-current={selected ? 'true' : undefined}
      className={cx(
        'group block rounded-md border bg-surface px-2.5 py-2 text-left shadow-card outline-none select-none',
        'focus-visible:ring-2 focus-visible:ring-ring',
        selected ? 'border-accent' : 'border-line hover:border-line-strong',
        ghost && 'opacity-40',
        overlay && 'rotate-[1deg] cursor-grabbing shadow-popover',
        card.archived && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-fg-faint">
        <TypeIcon type={card.type} size="0.75rem" />
        <span className="whitespace-nowrap font-mono">{card.key}</span>
        {parentKey && (
          <span className="flex items-center gap-0.5 font-mono">
            <CornerDownRight size="0.625rem" />
            {parentKey}
          </span>
        )}
        {card.archived && <Archive size="0.6875rem" aria-label="Archived" />}
        <span className="flex-1" />
        {card.priority !== 'none' && <PriorityIcon priority={card.priority} size="0.8125rem" />}
      </div>
      <div className={cx('mt-0.5 text-base leading-snug break-words text-fg', done && 'text-fg-muted')}>
        {card.title || <span className="text-fg-faint">Untitled</span>}
      </div>
      {(card.labels.length > 0 || due || epic || progressTotal > 0) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {epic && <EpicTag id={epic.id} title={epic.title} />}
          <LabelBadges names={card.labels} max={4} />
          {due && (
            <span
              className={cx(
                'inline-flex h-4.5 items-center gap-1 rounded px-1 text-xs',
                overdue ? 'bg-[var(--label-red-bg)] text-[var(--label-red-fg)]' : dueToday ? 'text-warning' : 'text-fg-muted',
              )}
              title={overdue ? `Overdue: ${due}` : `Due ${due}`}
            >
              <Calendar size="0.6875rem" />
              {formatDate(due)}
            </span>
          )}
          {progressTotal > 0 && <ProgressBadge done={progressDone} total={progressTotal} />}
        </div>
      )}
    </a>
  );
});
