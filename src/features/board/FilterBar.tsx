import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Archive, ChevronDown, ListTree, Search, X } from 'lucide-react';
import { PRIORITIES } from '@shared/types';
import { Button } from '../../components/Button';
import { Menu, MenuItem, MenuSeparator } from '../../components/Menu';
import { Popover } from '../../components/Popover';
import { cx } from '../../lib/cx';
import { useBoardData } from './context';
import { clearFilters, hasActiveFilters, NO_EPIC, withFlag, withValues, type Filters } from './filters';
import { PRIORITY_NAMES } from './format';
import { ColorDot, PriorityIcon, epicColor } from './ui';

export function FilterBar({ filters }: { filters: Filters }) {
  const { project, labels, epics } = useBoardData();
  const [params, setParams] = useSearchParams();
  const set = (next: URLSearchParams) => setParams(next, { replace: true, preventScrollReset: true });

  const selectFields = project.fields.filter((f) => (f.type === 'select' || f.type === 'multiselect') && f.options?.length);

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-4 pb-2">
      <SearchBox value={filters.q} onChange={(q) => set(q ? withValues(params, 'q', [q]) : withValues(params, 'q', []))} />
      <MultiFilter
        name="Labels"
        selected={filters.labels}
        onChange={(v) => set(withValues(params, 'label', v))}
        options={labels.map((l) => ({ value: l.name, label: l.name, icon: <ColorDot color={l.color} /> }))}
        empty="No labels yet"
      />
      <MultiFilter
        name="Priority"
        selected={filters.priorities}
        onChange={(v) => set(withValues(params, 'priority', v))}
        options={[...PRIORITIES].reverse().map((p) => ({ value: p, label: PRIORITY_NAMES[p], icon: <PriorityIcon priority={p} /> }))}
      />
      <MultiFilter
        name="Epic"
        selected={filters.epics}
        onChange={(v) => set(withValues(params, 'epic', v))}
        options={[
          { value: NO_EPIC, label: 'No epic' },
          ...epics.map((e) => ({ value: e.key, label: e.title || e.key, icon: <ColorDot color={epicColor(e.id)} /> })),
        ]}
      />
      {selectFields.map((f) => (
        <MultiFilter
          key={f.id}
          name={f.name}
          selected={filters.fields[f.key] ?? []}
          onChange={(v) => set(withValues(params, `f.${f.key}`, v))}
          options={(f.options ?? []).map((o) => ({ value: o, label: o }))}
        />
      ))}
      {hasActiveFilters(filters) && (
        <Button size="sm" variant="ghost" icon={<X size="0.75rem" />} onClick={() => set(clearFilters(params))}>
          Clear
        </Button>
      )}
      <span className="flex-1" />
      <Toggle on={filters.subtasks} onChange={(on) => set(withFlag(params, 'subtasks', on))} icon={<ListTree size="0.8125rem" />}>
        Subtasks
      </Toggle>
      <Toggle on={filters.archived} onChange={(on) => set(withFlag(params, 'archived', on))} icon={<Archive size="0.8125rem" />}>
        Archived
      </Toggle>
    </div>
  );
}

/** Search input; pushes to the URL after a short pause so typing stays smooth. */
function SearchBox({ value, onChange }: { value: string; onChange: (q: string) => void }) {
  const [text, setText] = useState(value);
  const last = useRef(value);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    // External change (back/forward, Clear).
    if (value !== last.current) {
      last.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    if (text === last.current) return;
    const t = setTimeout(() => {
      last.current = text;
      onChangeRef.current(text);
    }, 120);
    return () => clearTimeout(t);
  }, [text]);

  return (
    <label className="flex h-6 w-48 items-center gap-1.5 rounded-md border border-line bg-surface px-2 focus-within:border-accent focus-within:ring-2 focus-within:ring-ring">
      <Search size="0.75rem" className="shrink-0 text-fg-faint" />
      <input
        type="search"
        aria-label="Search cards"
        placeholder="Search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && text) {
            e.stopPropagation();
            setText('');
          }
        }}
        className="min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-fg-faint [&::-webkit-search-cancel-button]:hidden"
      />
    </label>
  );
}

interface Option {
  value: string;
  label: string;
  icon?: ReactNode;
}

function MultiFilter({
  name,
  options,
  selected,
  onChange,
  empty,
}: {
  name: string;
  options: Option[];
  selected: readonly string[];
  onChange: (values: string[]) => void;
  empty?: string;
}) {
  const active = selected.length > 0;
  const summary = active
    ? selected.length === 1
      ? (options.find((o) => o.value === selected[0])?.label ?? selected[0])
      : `${selected.length} selected`
    : null;
  return (
    <Popover
      trigger={(props) => (
        <button
          {...props}
          type="button"
          className={cx(
            'inline-flex h-6 max-w-56 items-center gap-1 rounded-md border px-2 text-sm',
            active ? 'border-accent/50 bg-accent-soft text-fg' : 'border-line text-fg-muted hover:bg-hover hover:text-fg',
          )}
        >
          <span className="shrink-0">
            {name}
            {summary && ':'}
          </span>
          {summary && <span className="truncate font-medium">{summary}</span>}
          <ChevronDown size="0.75rem" className="shrink-0 opacity-60" />
        </button>
      )}
      className="w-56"
    >
      <Menu>
        {options.length === 0 && <div className="px-2 py-1.5 text-sm text-fg-faint">{empty ?? 'Nothing to filter by'}</div>}
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <MenuItem
              key={o.value}
              keepOpen
              selected={on}
              icon={o.icon}
              onSelect={() => onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
            >
              {o.label}
            </MenuItem>
          );
        })}
        {active && (
          <>
            <MenuSeparator />
            <MenuItem onSelect={() => onChange([])}>Clear</MenuItem>
          </>
        )}
      </Menu>
    </Popover>
  );
}

function Toggle({ on, onChange, icon, children }: { on: boolean; onChange: (on: boolean) => void; icon: ReactNode; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cx(
        'inline-flex h-6 items-center gap-1 rounded-md px-2 text-sm',
        on ? 'bg-active text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
      )}
    >
      {icon}
      {children}
    </button>
  );
}
