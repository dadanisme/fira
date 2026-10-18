import { useState, type KeyboardEvent } from 'react';
import { Plus } from 'lucide-react';
import type { CardType } from '@shared/types';
import { createCard } from '../../data/cards';
import { cx } from '../../lib/cx';
import { useBoardData } from './context';
import { usePendingCards, useRankAllocator } from './pending';

export function AddCard({ columnId, lastRank, visibleIds }: { columnId: string; lastRank: string | null; visibleIds: readonly string[] }) {
  const { project } = useBoardData();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const { pending, track } = usePendingCards(visibleIds);
  const nextRank = useRankAllocator(lastRank);

  const submit = () => {
    const t = title.trim();
    if (!t) return;
    setTitle('');
    const rank = nextRank();
    track(t, () => createCard(project, { title: t, rank, status: columnId }));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setTitle('');
      setOpen(false);
    }
  };

  return (
    <>
      {pending.map((p) => (
        <PendingTile key={p.tempId} title={p.title} />
      ))}
      {open ? (
        <div className="mt-1.5 rounded-md border border-accent bg-surface px-2.5 py-2 shadow-card">
          <textarea
            autoFocus
            rows={1}
            aria-label="New card title"
            placeholder="Card title, Enter to add"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => {
              if (!title.trim()) setOpen(false);
            }}
            className="field-sizing-content block w-full resize-none bg-transparent text-[13px] leading-snug text-fg outline-none placeholder:text-fg-faint"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-1 flex h-7 w-full shrink-0 items-center gap-1.5 rounded-md px-1.5 text-[12px] text-fg-faint hover:bg-hover hover:text-fg-muted"
        >
          <Plus size={14} /> Add card
        </button>
      )}
    </>
  );
}

export function PendingTile({ title, type, className }: { title: string; type?: CardType; className?: string }) {
  return (
    <div
      aria-busy="true"
      className={cx(
        'mt-1.5 rounded-md border border-dashed border-line bg-surface px-2.5 py-2 text-[13px] leading-snug text-fg-muted',
        className,
      )}
    >
      <div className="text-[11px] text-fg-faint">{type === 'epic' ? 'New epic…' : 'Creating…'}</div>
      {title}
    </div>
  );
}
