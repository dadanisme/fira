import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from '../lib/cx';
import { Menu, MenuItem } from './Menu';
import { Popover } from './Popover';

export interface SelectOption<T extends string> {
  value: T;
  /** Shown in the trigger and the menu. */
  label: string;
  icon?: ReactNode;
  /** Muted text after the label, in the menu only (e.g. an email after a name). */
  hint?: ReactNode;
  disabled?: boolean;
  /** Menu-only indent level, for trees. */
  depth?: number;
}

export interface SelectProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  /** Shown when `value` matches no option. */
  placeholder?: string;
  /** Width (w-32, flex-1); the menu is at least as wide as the trigger. */
  className?: string;
  disabled?: boolean;
  'aria-label': string;
}

/**
 * Single-choice dropdown: an h-7 field that opens a Menu of options in a Popover.
 * Enter, Space, ArrowDown or ArrowUp opens it with the selected option focused; arrows,
 * Home and End move, Enter picks, Escape closes. Focus returns to the trigger.
 */
export function Select<T extends string>({ value, onChange, options, placeholder, className, disabled, 'aria-label': label }: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState<number>();
  const trigger = useRef<HTMLButtonElement | null>(null);
  const current = options.find((o) => o.value === value);

  const changeOpen = (next: boolean) => {
    if (next) setWidth(trigger.current?.offsetWidth);
    setOpen(next);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    changeOpen(true);
  };

  return (
    <Popover
      open={open}
      onOpenChange={changeOpen}
      trigger={({ ref, ...props }) => (
        <button
          {...props}
          ref={(el) => {
            ref(el);
            trigger.current = el;
          }}
          type="button"
          aria-haspopup="menu"
          aria-label={label}
          disabled={disabled}
          onKeyDown={onKeyDown}
          className={cx(
            'relative flex h-7 min-w-0 items-center gap-2 rounded-md border border-line bg-surface pr-7 pl-2 text-left text-base text-fg outline-none',
            'focus:border-accent focus:ring-2 focus:ring-ring disabled:opacity-50',
            className,
          )}
        >
          {current ? (
            <>
              {current.icon && <span className="flex w-4 shrink-0 justify-center text-fg-muted">{current.icon}</span>}
              <span className="min-w-0 flex-1 truncate">{current.label}</span>
            </>
          ) : (
            <span className="min-w-0 flex-1 truncate text-fg-faint">{placeholder ?? 'Choose…'}</span>
          )}
          <ChevronDown size="0.875rem" className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-fg-faint" />
        </button>
      )}
    >
      <div style={{ minWidth: width }}>
        <Menu>
          {options.map((o) => (
            <MenuItem
              key={o.value}
              kind="radio"
              selected={o.value === value}
              disabled={o.disabled}
              icon={o.icon}
              onSelect={() => {
                trigger.current?.focus();
                if (o.value !== value) onChange(o.value);
              }}
            >
              <span style={o.depth ? { paddingLeft: `${o.depth * 0.75}rem` } : undefined}>{o.label}</span>
              {o.hint && <span className="ml-1.5 text-fg-faint">{o.hint}</span>}
            </MenuItem>
          ))}
        </Menu>
      </div>
    </Popover>
  );
}
