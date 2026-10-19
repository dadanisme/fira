import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cx } from '../lib/cx';
import { usePopoverClose } from './Popover';

/** Vertical menu with arrow-key navigation; focuses its first item on mount. Put inside a Popover. */
export function Menu({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const targets: Partial<Record<string, number>> = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 };
    const next = targets[e.key];
    if (next === undefined || items.length === 0) return;
    e.preventDefault();
    items[(next + items.length) % items.length].focus();
  };

  return (
    <div ref={ref} role="menu" onKeyDown={onKeyDown} className={cx('flex max-h-80 flex-col overflow-y-auto p-1', className)}>
      {children}
    </div>
  );
}

export interface MenuItemProps {
  onSelect: () => void;
  children: ReactNode;
  icon?: ReactNode;
  /** Shows a check mark (for single/multi-select menus). */
  selected?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** Keep the enclosing Popover open after selecting (multi-select). */
  keepOpen?: boolean;
  /** Tooltip; also shown while disabled (e.g. why the action is unavailable). */
  title?: string;
}

export function MenuItem({ onSelect, children, icon, selected, danger, disabled, keepOpen, title }: MenuItemProps) {
  const close = usePopoverClose();
  const button = (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        onSelect();
        if (!keepOpen) close();
      }}
      className={cx(
        'flex h-7 w-full shrink-0 items-center gap-2 rounded-md px-2 text-left text-base outline-none',
        'hover:bg-hover focus-visible:bg-hover focus-visible:outline-none disabled:opacity-50',
        title && 'disabled:pointer-events-none',
        danger ? 'text-danger' : 'text-fg',
      )}
      title={title}
    >
      {icon && <span className="flex w-4 shrink-0 justify-center text-fg-muted">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && <Check size="0.875rem" className="shrink-0 text-fg-muted" />}
    </button>
  );
  // Disabled buttons get no hover events; the wrapper carries the tooltip instead.
  return title && disabled ? (
    <span title={title} className="flex shrink-0 cursor-not-allowed">
      {button}
    </span>
  ) : (
    button
  );
}

export function MenuSeparator() {
  return <div role="separator" className="-mx-1 my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="px-2 pt-1.5 pb-1 text-xs font-medium text-fg-faint">{children}</div>;
}
