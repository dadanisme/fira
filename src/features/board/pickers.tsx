import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Check, Plus } from 'lucide-react';
import { LABEL_COLORS, type Card, type Label, type LabelColor } from '@shared/types';
import { colorFor, findLabel } from '@shared/labels';
import { ensureLabel } from '../../data/labels';
import { usePopoverClose } from '../../components/Popover';
import { cx } from '../../lib/cx';
import { ColorDot, TypeIcon } from './ui';

export interface ListItem {
  id: string;
  label: ReactNode;
  /** Text matched by the search box. */
  text: string;
  icon?: ReactNode;
  selected?: boolean;
  hint?: ReactNode;
}

/**
 * Searchable list for popovers: type to filter, arrows to move, Enter to pick.
 * `extra` renders below the items (e.g. "Create …"); `onEnterEmpty` runs on Enter
 * when nothing matches.
 */
export function SearchList({
  items,
  onPick,
  placeholder,
  query,
  onQuery,
  footer,
  onEnterEmpty,
  empty = 'No matches',
}: {
  items: ListItem[];
  onPick: (id: string) => void;
  placeholder: string;
  query: string;
  onQuery: (q: string) => void;
  footer?: ReactNode;
  onEnterEmpty?: () => void;
  empty?: string;
}) {
  const listId = useId();
  const [active, setActive] = useState(0);
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => (q ? items.filter((i) => i.text.toLowerCase().includes(q)) : items), [items, q]);
  const index = Math.min(active, shown.length - 1);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (Math.max(0, Math.min(i, shown.length - 1)) + d + shown.length) % Math.max(1, shown.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[index]) onPick(shown[index].id);
      else onEnterEmpty?.();
    }
  };

  return (
    <div className="flex flex-col">
      <input
        autoFocus
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={shown[index] ? `${listId}-${index}` : undefined}
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          onQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        className="h-8 border-b border-line bg-transparent px-2.5 text-base text-fg outline-none placeholder:text-fg-faint"
      />
      <div id={listId} role="listbox" className="flex max-h-72 flex-col overflow-y-auto p-1">
        {shown.map((item, i) => (
          <button
            key={item.id}
            id={`${listId}-${i}`}
            type="button"
            role="option"
            aria-selected={item.selected ?? false}
            tabIndex={-1}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(item.id)}
            className={cx(
              'flex h-7 w-full shrink-0 items-center gap-2 rounded-md px-2 text-left text-base text-fg',
              i === index && 'bg-hover',
            )}
          >
            {item.icon && <span className="flex w-4 shrink-0 justify-center text-fg-muted">{item.icon}</span>}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.hint && <span className="shrink-0 text-xs text-fg-faint">{item.hint}</span>}
            {item.selected && <Check size="0.875rem" className="shrink-0 text-fg-muted" />}
          </button>
        ))}
        {shown.length === 0 && !footer && <div className="px-2 py-1.5 text-sm text-fg-faint">{empty}</div>}
        {footer}
      </div>
    </div>
  );
}

/** Multi-select label picker; typing a new name offers to create it (with a color). */
export function LabelPicker({
  labels,
  selected,
  onChange,
}: {
  labels: readonly Label[];
  selected: readonly string[];
  onChange: (names: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  const exists = trimmed ? findLabel(labels, trimmed) : undefined;
  const [color, setColor] = useState<LabelColor | null>(null);
  const newColor = color ?? colorFor(trimmed);

  const isSelected = (name: string) => selected.some((s) => s.toLowerCase() === name.toLowerCase());
  const toggle = (name: string) =>
    onChange(isSelected(name) ? selected.filter((s) => s.toLowerCase() !== name.toLowerCase()) : [...selected, name]);

  const create = () => {
    if (!trimmed || exists) return;
    const label = ensureLabel(labels, trimmed, newColor);
    onChange([...selected, label.name]);
    setQuery('');
    setColor(null);
  };

  const items = labels.map((l) => ({
    id: l.name,
    label: l.name,
    text: l.name,
    icon: <ColorDot color={l.color} />,
    selected: isSelected(l.name),
  }));

  return (
    <SearchList
      items={items}
      onPick={toggle}
      placeholder="Search or create label…"
      query={query}
      onQuery={setQuery}
      onEnterEmpty={create}
      footer={
        trimmed && !exists ? (
          <div className="mt-1 border-t border-line pt-1">
            <button
              type="button"
              onClick={create}
              className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-base text-fg hover:bg-hover"
            >
              <Plus size="0.875rem" className="text-fg-muted" />
              <span className="truncate">
                Create <strong className="font-medium">“{trimmed}”</strong>
              </span>
            </button>
            <ColorSwatches value={newColor} onChange={setColor} className="px-2 pt-1 pb-1.5" />
          </div>
        ) : undefined
      }
    />
  );
}

export function ColorSwatches({
  value,
  onChange,
  className,
}: {
  value: LabelColor;
  onChange: (c: LabelColor) => void;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label="Color" className={cx('flex flex-wrap gap-1', className)}>
      {LABEL_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c === value}
          aria-label={c}
          title={c}
          onClick={() => onChange(c)}
          className={cx(
            'flex size-5 items-center justify-center rounded-full',
            c === value ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface' : 'hover:ring-1 hover:ring-line-strong',
          )}
          style={{ background: `var(--label-${c}-bg)` }}
        >
          <span className="size-2.5 rounded-full" style={{ background: `var(--label-${c}-fg)` }} />
        </button>
      ))}
    </div>
  );
}

/** Single card picker (epic or parent card), with "None". Closes the popover on pick. */
export function CardPicker({
  cards,
  selectedId,
  onSelect,
  placeholder,
}: {
  cards: readonly Card[];
  selectedId: string | undefined;
  onSelect: (id: string | null) => void;
  placeholder: string;
}) {
  const close = usePopoverClose();
  const [query, setQuery] = useState('');
  const items: ListItem[] = [
    { id: '', label: <span className="text-fg-muted">None</span>, text: 'none', selected: !selectedId },
    ...cards.map((c) => ({
      id: c.id,
      label: c.title || 'Untitled',
      text: `${c.key} ${c.title}`,
      icon: <TypeIcon type={c.type} />,
      hint: <span className="whitespace-nowrap font-mono">{c.key}</span>,
      selected: c.id === selectedId,
    })),
  ];
  return (
    <SearchList
      items={items}
      query={query}
      onQuery={setQuery}
      placeholder={placeholder}
      onPick={(id) => {
        onSelect(id || null);
        close();
      }}
    />
  );
}
