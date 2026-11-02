import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUpToLine, FileText, LayoutTemplate, Search, X } from 'lucide-react';
import type { Page } from '@shared/types';
import { Dialog } from '../../components/Dialog';
import { IconButton } from '../../components/IconButton';
import { cx } from '../../lib/cx';
import { NO_HOVER } from '../../lib/useMediaQuery';
import { pageTitle } from './actions';
import { childrenMap } from './tree';

interface Target {
  /** null = top level. */
  id: string | null;
  page?: Page;
  depth: number;
}

/** "Move to…": a searchable list of the section's pages (not the page itself or its descendants). */
export function MovePageDialog({
  page,
  pages,
  open,
  onClose,
  onExited,
  onMove,
}: {
  page: Page;
  pages: readonly Page[];
  open: boolean;
  onClose(): void;
  onExited(): void;
  onMove(parentId: string | null): void;
}) {
  const titleId = useId();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // After the Dialog's own effect (which focuses its panel). On touch, no keyboard until the field is tapped.
  useEffect(() => {
    if (open && !matchMedia(NO_HOVER).matches) input.current?.focus();
  }, [open]);
  const children = useMemo(() => childrenMap(pages, page.isTemplate), [pages, page.isTemplate]);
  const currentParent = useMemo(() => {
    for (const [parent, kids] of children) if (kids.some((p) => p.id === page.id)) return parent;
    return null;
  }, [children, page.id]);

  const targets = useMemo<Target[]>(() => {
    const q = query.trim().toLowerCase();
    const out: Target[] = q ? [] : [{ id: null, depth: 0 }];
    const visit = (parentId: string | null, depth: number) => {
      for (const p of children.get(parentId) ?? []) {
        if (p.id === page.id) continue; // skips its subtree too
        if (!q || pageTitle(p).toLowerCase().includes(q)) out.push({ id: p.id, page: p, depth: q ? 0 : depth });
        visit(p.id, depth + 1);
      }
    };
    visit(null, 0);
    return out;
  }, [children, page.id, query]);

  const active = Math.min(index, targets.length - 1);
  const choose = (t: Target) => {
    if (t.id === currentParent) return;
    onMove(t.id);
    onClose();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const steps: Partial<Record<string, number>> = { ArrowDown: 1, ArrowUp: -1 };
    const step = steps[e.key];
    if (step !== undefined && targets.length > 0) {
      e.preventDefault();
      const next = (active + step + targets.length) % targets.length;
      setIndex(next);
      list.current?.querySelector(`[data-index="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && targets[active]) {
      e.preventDefault();
      choose(targets[active]);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} onExited={onExited} labelledBy={titleId} className="sm:w-[28rem]">
      <div className="flex h-11 shrink-0 items-center gap-2 pr-2 pl-4">
        <h2 id={titleId} className="min-w-0 flex-1 truncate text-base font-semibold">
          Move “{pageTitle(page)}” to…
        </h2>
        <IconButton label="Close" onClick={onClose}>
          <X size="0.9375rem" />
        </IconButton>
      </div>
      <div className="px-3 pb-2">
        <label className="flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-2 focus-within:border-accent touch:h-11">
          <Search size="0.875rem" className="shrink-0 text-fg-faint" />
          <input
            ref={input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Search pages"
            aria-label="Search pages"
            role="combobox"
            aria-expanded
            aria-controls={`${titleId}-list`}
            aria-activedescendant={targets[active] ? `${titleId}-${active}` : undefined}
            className="h-full min-w-0 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-faint"
          />
        </label>
      </div>
      <div
        ref={list}
        id={`${titleId}-list`}
        role="listbox"
        aria-label="Destination"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2 sm:max-h-80 sm:flex-none"
      >
        {targets.length === 0 && <p className="px-2 py-3 text-sm text-fg-faint">No matching pages</p>}
        {targets.map((t, i) => {
          const current = t.id === currentParent;
          return (
            <button
              key={t.id ?? ''}
              id={`${titleId}-${i}`}
              type="button"
              role="option"
              aria-selected={i === active}
              aria-disabled={current}
              data-index={i}
              tabIndex={-1}
              onClick={() => choose(t)}
              onPointerMove={() => setIndex(i)}
              className={cx(
                'flex h-8 w-full shrink-0 items-center gap-2 rounded-md pr-2 text-left text-base touch:h-11',
                i === active && 'bg-hover',
                current ? 'text-fg-faint' : 'text-fg',
              )}
              style={{ paddingLeft: `${0.5 + t.depth * 0.75}rem` }}
            >
              <span className="flex w-4 shrink-0 justify-center text-fg-muted">
                {!t.page ? (
                  <ArrowUpToLine size="0.875rem" />
                ) : t.page.icon ? (
                  <span className="leading-none">{t.page.icon}</span>
                ) : t.page.isTemplate ? (
                  <LayoutTemplate size="0.875rem" />
                ) : (
                  <FileText size="0.875rem" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate">{t.page ? pageTitle(t.page) : 'Top level'}</span>
              {current && <span className="shrink-0 text-xs text-fg-faint">Current</span>}
            </button>
          );
        })}
      </div>
    </Dialog>
  );
}
