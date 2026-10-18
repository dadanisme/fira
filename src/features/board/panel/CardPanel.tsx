import { useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, Copy, Ellipsis, Link2, Maximize2, Minimize2, X } from 'lucide-react';
import type { Card } from '@shared/types';
import { IconButton } from '../../../components/IconButton';
import { Menu, MenuItem } from '../../../components/Menu';
import { Popover } from '../../../components/Popover';
import { cx } from '../../../lib/cx';
import { patchCard, useBoardData } from '../context';
import { TypeIcon } from '../ui';
import { ActivityTimeline } from './ActivityTimeline';
import { Attachments } from './Attachments';
import { Children } from './Children';
import { Comments } from './Comments';
import { Description } from './Description';
import { EditableText } from './EditableText';
import { Properties } from './Properties';
import { WorkPage } from './WorkPage';

const EXPANDED_KEY = 'fira-peek-expanded';

function readExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_KEY) === '1';
  } catch {
    return false;
  }
}

function isEditable(el: EventTarget | null): el is HTMLElement {
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/**
 * Side peek over the right of the board (the board stays visible and interactive).
 * Escape closes it, or first leaves the field being edited. "Expand" covers the board.
 */
export function CardPanel({
  cardKey,
  loading,
  onClose,
  onOpen,
}: {
  cardKey: string;
  loading: boolean;
  onClose: () => void;
  onOpen: (key: string) => void;
}) {
  const data = useBoardData();
  const card = data.byKey.get(cardKey);
  const [expanded, setExpanded] = useState(readExpanded);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    // On window: popovers handle Escape on document and stop it there.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (isEditable(e.target)) {
        e.target.blur();
        return;
      }
      onClose();
    };
    addEventListener('keydown', onKeyDown);
    return () => removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    // Move focus into the panel when it opens or switches cards, unless typing somewhere.
    if (!isEditable(document.activeElement)) panel.current?.focus({ preventScroll: true });
  }, [cardKey]);

  const toggleExpanded = () => {
    setExpanded((x) => {
      try {
        localStorage.setItem(EXPANDED_KEY, x ? '0' : '1');
      } catch {
        // ignore
      }
      return !x;
    });
  };

  return (
    <aside
      ref={panel}
      tabIndex={-1}
      aria-label={`Card ${cardKey}`}
      className={cx(
        'absolute inset-y-0 right-0 z-20 flex flex-col bg-bg outline-none',
        expanded ? 'left-0' : 'w-[min(640px,100%)] border-l border-line shadow-popover',
      )}
    >
      <header className="flex h-11 shrink-0 items-center gap-1 border-b border-line px-3">
        <Breadcrumb card={card} cardKey={cardKey} onOpen={onOpen} />
        <span className="flex-1" />
        {card && <PanelMenu card={card} />}
        <IconButton label={expanded ? 'Collapse to side peek' : 'Expand to full width'} onClick={toggleExpanded}>
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </IconButton>
        <IconButton label="Close (Esc)" onClick={onClose}>
          <X size={15} />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {card ? (
          <CardDetail key={card.id} card={card} onOpen={onOpen} wide={expanded} />
        ) : (
          !loading && <p className="p-6 text-fg-muted">Card {cardKey} not found in this project.</p>
        )}
      </div>
    </aside>
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
        className="max-w-40 truncate rounded px-1 font-mono text-[12px] text-fg-muted hover:bg-hover hover:text-fg"
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
      <span className="flex items-center gap-1 px-1 font-mono text-[12px] font-medium text-fg">
        {card && <TypeIcon type={card.type} />}
        {cardKey}
      </span>
      {card?.archived && <span className="rounded bg-sunken px-1.5 text-[11px] text-fg-muted">Archived</span>}
    </nav>
  );
}

function PanelMenu({ card }: { card: Card }) {
  const data = useBoardData();
  const url = `${location.origin}/p/${data.project.key}/${card.key}`;
  const copy = (text: string) => void navigator.clipboard?.writeText(text);
  return (
    <>
      <IconButton label="Copy link" onClick={() => copy(url)}>
        <Link2 size={14} />
      </IconButton>
      <Popover
        placement="bottom-end"
        trigger={(p) => (
          <IconButton {...p} label="More actions">
            <Ellipsis size={15} />
          </IconButton>
        )}
      >
        <Menu>
          <MenuItem icon={<Copy size={14} />} onSelect={() => copy(card.key)}>
            Copy key
          </MenuItem>
          <MenuItem
            icon={card.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            onSelect={() => patchCard(data, card, { archived: !card.archived })}
          >
            {card.archived ? 'Unarchive' : 'Archive'}
          </MenuItem>
        </Menu>
      </Popover>
    </>
  );
}

function CardDetail({ card, onOpen, wide }: { card: Card; onOpen: (key: string) => void; wide: boolean }) {
  const data = useBoardData();
  return (
    <div className={cx('flex flex-col gap-5 px-4 pt-4 pb-10', wide && 'mx-auto w-full max-w-3xl')}>
      {card.archived && (
        <div className="flex items-center gap-2 rounded-md bg-sunken px-3 py-2 text-xs text-fg-muted">
          <Archive size={13} />
          <span className="flex-1">This card is archived and hidden from the board.</span>
          <button type="button" className="font-medium text-fg hover:underline" onClick={() => patchCard(data, card, { archived: false })}>
            Unarchive
          </button>
        </div>
      )}
      <EditableText
        multiline
        label="Title"
        placeholder="Untitled"
        allowEmpty={false}
        value={card.title}
        onCommit={(title) => patchCard(data, card, { title: title.trim() })}
        className="text-[20px] leading-tight font-semibold"
      />
      <Properties card={card} />
      <div className="flex flex-col">
        <div className="flex h-7 items-center px-2 text-[12px] font-medium text-fg-muted">Description</div>
        <Description card={card} />
      </div>
      {card.type !== 'subtask' && <Children card={card} onOpen={onOpen} />}
      <WorkPage card={card} />
      <Attachments card={card} />
      <Comments card={card} />
      <ActivityTimeline card={card} />
    </div>
  );
}
