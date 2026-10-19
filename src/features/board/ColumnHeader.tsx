import { useRef, useState, type KeyboardEvent, type Ref } from 'react';
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core';
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Column } from '@shared/types';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { Menu, MenuItem } from '../../components/Menu';
import { Popover } from '../../components/Popover';
import { cx } from '../../lib/cx';
import { deleteBlockedReason } from './columns';
import { justDragged } from './dragClock';

export interface ColumnHeaderProps {
  column: Column;
  /** Cards shown (after filters). */
  visibleCount: number;
  /** All cards in the column, archived included. */
  cardTotal: number;
  columnCount: number;
  onRename: (name: string) => void;
  onRemove: () => void;
  /** Drag handle wiring from the column's useSortable. */
  handleRef: Ref<HTMLElement>;
  handleAttributes: DraggableAttributes;
  handleListeners: DraggableSyntheticListeners;
}

/** Column header: the drag handle for reordering, click-to-rename name, and a ⋯ menu. */
export function ColumnHeader({
  column,
  visibleCount,
  cardTotal,
  columnCount,
  onRename,
  onRemove,
  handleRef,
  handleAttributes,
  handleListeners,
}: ColumnHeaderProps) {
  const [editing, setEditing] = useState(false);
  const blocked = deleteBlockedReason(cardTotal, columnCount);
  // The header holds buttons; keep it a plain focusable region rather than role="button".
  const { role: _role, ...attributes } = handleAttributes;

  return (
    <header
      ref={handleRef}
      {...attributes}
      {...(editing ? {} : handleListeners)}
      className={cx(
        'group/header flex h-9 shrink-0 items-center gap-1 rounded-t-lg px-1.5 text-sm font-medium text-fg-muted outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring',
        !editing && 'cursor-grab active:cursor-grabbing',
      )}
    >
      {editing ? (
        <RenameInput
          value={column.name}
          onDone={(name) => {
            setEditing(false);
            if (name !== null) onRename(name);
          }}
        />
      ) : (
        <button
          type="button"
          title="Rename"
          onClick={() => !justDragged() && setEditing(true)}
          className="h-6 min-w-0 cursor-pointer truncate rounded px-1.5 text-left hover:bg-hover hover:text-fg"
        >
          {column.name}
        </button>
      )}
      {!editing && <span className="text-fg-faint tabular-nums">{visibleCount}</span>}
      <span className="flex-1" />
      <Popover
        placement="bottom-end"
        className="w-48"
        trigger={(props) => (
          <IconButton
            {...props}
            label={`${column.name} actions`}
            onPointerDown={(e) => e.stopPropagation()}
            className="size-6 opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
          >
            <MoreHorizontal size="0.875rem" />
          </IconButton>
        )}
      >
        <Menu>
          <MenuItem icon={<Pencil size="0.8125rem" />} onSelect={() => setEditing(true)}>
            Rename
          </MenuItem>
          <MenuItem icon={<Trash2 size="0.8125rem" />} danger disabled={Boolean(blocked)} title={blocked ?? undefined} onSelect={onRemove}>
            Delete
          </MenuItem>
        </Menu>
      </Popover>
    </header>
  );
}

function RenameInput({ value, onDone }: { value: string; onDone: (name: string | null) => void }) {
  const [draft, setDraft] = useState(value);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      finish(draft);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(null);
    }
  };
  return (
    <Input
      autoFocus
      aria-label="Column name"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => finish(draft)}
      className="h-6 flex-1 px-1.5 text-sm font-medium"
    />
  );
}

/** "+ Add column" after the last column: click for an inline name input; Enter adds, Esc cancels. */
export function AddColumn({ onAdd }: { onAdd: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  const close = () => {
    setName('');
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!name.trim()) return;
      onAdd(name);
      setName('');
      requestAnimationFrame(() => ref.current?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' }));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };

  return (
    <div ref={ref} className="w-72 shrink-0">
      {open ? (
        <div className="rounded-lg bg-sunken/70 p-1.5">
          <Input
            autoFocus
            aria-label="New column name"
            placeholder="Column name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => !name.trim() && close()}
            className="w-full"
          />
          <p className="px-1 pt-1 text-xs text-fg-faint">Enter to add, Esc to cancel</p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex h-9 w-full items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-fg-faint hover:bg-sunken/70 hover:text-fg-muted"
        >
          <Plus size="0.875rem" /> Add column
        </button>
      )}
    </div>
  );
}
