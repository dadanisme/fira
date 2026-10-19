import { useEffect, useId, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Copy, Link2, X } from 'lucide-react';
import type { Card } from '@shared/types';
import { Dialog } from '../../../components/Dialog';
import { IconButton } from '../../../components/IconButton';
import { patchCard, useBoardData } from '../context';
import { TypeIcon } from '../ui';
import { Attachments } from './Attachments';
import { CardActivity } from './CardActivity';
import { Children } from './Children';
import { Description } from './Description';
import { EditableText } from './EditableText';
import { Properties } from './Properties';
import { WorkPage } from './WorkPage';

/**
 * Card detail as a centered modal over the board (full-screen sheet on phones).
 * The board stays mounted underneath; closing returns focus to the tile it opened from.
 */
export function CardDialog({
  cardKey,
  open,
  loading,
  onClose,
  onExited,
  onOpen,
}: {
  cardKey: string;
  open: boolean;
  loading: boolean;
  onClose: () => void;
  onExited: () => void;
  onOpen: (key: string) => void;
}) {
  const data = useBoardData();
  const card = data.byKey.get(cardKey);
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  // The card the dialog was opened for (breadcrumbs and subtasks switch cards inside it).
  const [openerKey] = useState(cardKey);
  const projectKey = data.project.key;

  useEffect(() => {
    // Switching cards replaces the content; keep focus inside the dialog.
    panel.current?.focus({ preventScroll: true });
  }, [cardKey]);

  return (
    <Dialog
      ref={panel}
      open={open}
      onClose={onClose}
      onExited={onExited}
      labelledBy={titleId}
      returnFocus={() => document.querySelector<HTMLElement>(`a[href="/p/${projectKey}/${openerKey}"]`)}
      className="sm:max-w-230 sm:border sm:border-line"
    >
      <h2 id={titleId} className="sr-only">
        {card ? `${card.key} ${card.title}` : cardKey}
      </h2>
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-3">
        <Breadcrumb card={card} cardKey={cardKey} onOpen={onOpen} />
        <span className="flex-1" />
        {card && <Actions card={card} />}
        <IconButton label="Close (Esc)" onClick={onClose}>
          <X size="0.9375rem" />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {card ? (
          <CardDetail key={card.id} card={card} onOpen={onOpen} />
        ) : (
          !loading && <p className="p-6 text-fg-muted">Card {cardKey} not found in this project.</p>
        )}
      </div>
    </Dialog>
  );
}

function Breadcrumb({ card, cardKey, onOpen }: { card: Card | undefined; cardKey: string; onOpen: (key: string) => void }) {
  const data = useBoardData();
  const parent = card?.parentId ? data.byId.get(card.parentId) : undefined;
  const grand = parent?.parentId ? data.byId.get(parent.parentId) : undefined;
  const crumb = (c: Card) => (
    <>
      <button
        type="button"
        onClick={() => onOpen(c.key)}
        title={c.title}
        className="max-w-40 truncate rounded px-1 font-mono text-sm text-fg-muted hover:bg-hover hover:text-fg"
      >
        {c.key}
      </button>
      <span className="text-fg-faint">/</span>
    </>
  );
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1">
      {grand && crumb(grand)}
      {parent && crumb(parent)}
      <span className="flex items-center gap-1 px-1 font-mono text-sm font-medium text-fg">
        {card && <TypeIcon type={card.type} />}
        {cardKey}
      </span>
      {card?.archived && <span className="rounded bg-sunken px-1.5 text-xs text-fg-muted">Archived</span>}
    </nav>
  );
}

function Actions({ card }: { card: Card }) {
  const data = useBoardData();
  const url = `${location.origin}/p/${data.project.key}/${card.key}`;
  const copy = (text: string) => void navigator.clipboard?.writeText(text);
  return (
    <>
      <IconButton label="Copy key" onClick={() => copy(card.key)}>
        <Copy size="0.875rem" />
      </IconButton>
      <IconButton label="Copy link" onClick={() => copy(url)}>
        <Link2 size="0.875rem" />
      </IconButton>
      <IconButton label={card.archived ? 'Unarchive' : 'Archive'} onClick={() => patchCard(data, card, { archived: !card.archived })}>
        {card.archived ? <ArchiveRestore size="0.875rem" /> : <Archive size="0.875rem" />}
      </IconButton>
    </>
  );
}

/**
 * Wide: main column (title, description, subtasks, …) and a properties column.
 * Narrow: one column, properties right under the title.
 */
function CardDetail({ card, onOpen }: { card: Card; onOpen: (key: string) => void }) {
  const data = useBoardData();
  return (
    <div className="flex flex-col gap-4 px-4 pt-4 pb-10 md:px-6">
      {card.archived && (
        <div className="flex items-center gap-2 rounded-md bg-sunken px-3 py-2 text-sm text-fg-muted">
          <Archive size="0.8125rem" />
          <span className="flex-1">This card is archived and hidden from the board.</span>
          <button type="button" className="font-medium text-fg hover:underline" onClick={() => patchCard(data, card, { archived: false })}>
            Unarchive
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-[minmax(0,1fr)_17rem] md:grid-rows-[auto_1fr]">
        <EditableText
          multiline
          label="Title"
          placeholder="Untitled"
          allowEmpty={false}
          value={card.title}
          onCommit={(title) => patchCard(data, card, { title: title.trim() })}
          className="text-xl leading-tight font-semibold"
        />
        <aside aria-label="Properties" className="md:row-span-2 md:border-l md:border-line md:pl-4">
          <Properties card={card} />
        </aside>
        <div className="flex min-w-0 flex-col gap-5 md:col-start-1 md:row-start-2">
          <div className="flex flex-col">
            <div className="flex h-7 items-center px-2 text-sm font-medium text-fg-muted">Description</div>
            <Description card={card} />
          </div>
          {card.type !== 'subtask' && <Children card={card} onOpen={onOpen} />}
          <WorkPage card={card} />
          <Attachments card={card} />
          <CardActivity card={card} />
        </div>
      </div>
    </div>
  );
}
