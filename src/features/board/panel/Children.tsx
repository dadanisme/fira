import { useMemo, useState, type KeyboardEvent } from 'react';
import { Plus } from 'lucide-react';
import type { Card } from '@shared/types';
import { compareRank, rankAfterLast } from '@shared/rank';
import { createCard } from '../../../data/cards';
import { cx } from '../../../lib/cx';
import { usePendingCards, useRankAllocator } from '../pending';
import { patchCard, useBoardData } from '../context';
import { PriorityIcon, ProgressBadge } from '../ui';
import { Section } from './Section';

/**
 * Subtasks of a card, or the cards of an epic. Checking one off moves it to the last
 * (done) column; unchecking moves it back to the first.
 */
export function Children({ card, onOpen }: { card: Card; onOpen: (key: string) => void }) {
  const data = useBoardData();
  const { project, doneId } = data;
  const childType = card.type === 'epic' ? 'card' : 'subtask';
  const children = useMemo(
    () => (data.childrenOf.get(card.id) ?? []).filter((c) => c.type === childType && !c.archived),
    [data.childrenOf, card.id, childType],
  );
  const ids = useMemo(() => children.map((c) => c.id), [children]);
  const { pending, track } = usePendingCards(ids);
  const first = project.columns[0]?.id;
  const firstColumnLast = useMemo(() => {
    let max: string | null = null;
    for (const c of data.cards) if (c.status === first && (max === null || compareRank(c.rank, max) > 0)) max = c.rank;
    return max;
  }, [data.cards, first]);
  const nextRank = useRankAllocator(firstColumnLast);
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);

  const done = children.filter((c) => c.status === doneId).length;

  const toggle = (child: Card) => {
    const target = child.status === doneId ? first : doneId;
    if (!target) return;
    patchCard(data, child, { status: target, rank: rankAfterLast(data.cards.filter((c) => c.status === target && c.id !== child.id)) });
  };

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    setTitle('');
    const rank = nextRank();
    track(t, () => createCard(project, { title: t, type: childType, parentId: card.id, rank, status: first }));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setTitle('');
      setAdding(false);
    }
  };

  const label = card.type === 'epic' ? 'Cards' : 'Subtasks';
  return (
    <Section
      title={label}
      meta={children.length > 0 && <ProgressBadge done={done} total={children.length} />}
      action={
        <button
          type="button"
          aria-label={`Add ${childType}`}
          title={`Add ${childType}`}
          onClick={() => setAdding(true)}
          className="inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Plus size={14} />
        </button>
      }
    >
      <ul className="flex flex-col">
        {children.map((c) => {
          const isDone = c.status === doneId;
          return (
            <li key={c.id} className="group flex h-8 items-center gap-2 rounded-md px-2 hover:bg-hover">
              <input
                type="checkbox"
                checked={isDone}
                onChange={() => toggle(c)}
                aria-label={`${isDone ? 'Reopen' : 'Complete'} ${c.key}`}
                className="size-3.5 shrink-0 accent-[var(--accent)]"
              />
              <span className="shrink-0 font-mono text-[11px] text-fg-faint">{c.key}</span>
              <button
                type="button"
                onClick={() => onOpen(c.key)}
                className={cx('min-w-0 flex-1 truncate text-left hover:underline', isDone && 'text-fg-muted line-through')}
              >
                {c.title || 'Untitled'}
              </button>
              {c.priority !== 'none' && <PriorityIcon priority={c.priority} size={13} />}
              <span className="shrink-0 text-[11px] text-fg-faint">{project.columns.find((col) => col.id === c.status)?.name}</span>
            </li>
          );
        })}
        {pending.map((p) => (
          <li key={p.tempId} aria-busy="true" className="flex h-8 items-center gap-2 px-2 text-fg-faint">
            <input type="checkbox" disabled aria-hidden className="size-3.5" />
            <span className="truncate">{p.title}</span>
          </li>
        ))}
      </ul>
      {adding ? (
        <input
          autoFocus
          aria-label={`New ${childType} title`}
          placeholder={`${childType === 'card' ? 'Card' : 'Subtask'} title, Enter to add`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => !title.trim() && setAdding(false)}
          className="mt-0.5 h-8 w-full rounded-md border border-line bg-surface px-2 text-[13px] text-fg outline-none placeholder:text-fg-faint focus:border-accent"
        />
      ) : (
        children.length === 0 &&
        pending.length === 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-faint hover:bg-hover hover:text-fg-muted"
          >
            <Plus size={14} /> Add {childType}
          </button>
        )
      )}
    </Section>
  );
}
