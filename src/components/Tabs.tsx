import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** Shown after the label in a quieter tone (e.g. "Comments 4"). */
  count?: number;
}

export interface TabsProps<T extends string> {
  /** Prefix for the tab and panel ids; pair with <TabPanel id={id} value={…}>. */
  id: string;
  /** Accessible name of the tab list. */
  label: string;
  items: readonly TabItem<T>[];
  value: T;
  onChange(value: T): void;
  className?: string;
}

const tabId = (id: string, value: string) => `${id}-tab-${value}`;
const tabPanelId = (id: string, value: string) => `${id}-panel-${value}`;

/**
 * Understated underline tabs (WAI-ARIA tabs pattern, automatic activation):
 * Left/Right move between tabs and select them, Home/End jump to the ends,
 * only the selected tab is in the Tab order. Render the active panel with <TabPanel>.
 */
export function Tabs<T extends string>({ id, label, items, value, onChange, className }: TabsProps<T>) {
  const list = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((t) => t.value === value);
    const n = items.length;
    const next =
      e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (next < 0 || e.altKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    const target = items[next];
    onChange(target.value);
    list.current?.querySelector<HTMLElement>(`#${CSS.escape(tabId(id, target.value))}`)?.focus();
  };

  return (
    <div ref={list} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cx('flex items-end gap-4 border-b border-line', className)}>
      {items.map((t) => {
        const selected = t.value === value;
        return (
          <button
            key={t.value}
            id={tabId(id, t.value)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={tabPanelId(id, t.value)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.value)}
            className={cx(
              '-mb-px flex h-8 items-center gap-1.5 border-b-2 px-0.5 text-sm font-medium transition-colors outline-none select-none',
              'focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring',
              selected ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:border-line-strong hover:text-fg',
            )}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && <span className="text-xs text-fg-faint tabular-nums">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The panel of the selected tab. Render only the active one. */
export function TabPanel({ id, value, className, children }: { id: string; value: string; className?: string; children: ReactNode }) {
  return (
    <div id={tabPanelId(id, value)} role="tabpanel" aria-labelledby={tabId(id, value)} className={className}>
      {children}
    </div>
  );
}
