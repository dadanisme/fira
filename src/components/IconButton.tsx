import type { ComponentProps, ReactNode } from 'react';
import { cx } from '../lib/cx';

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children'> {
  /** Accessible name, also shown as the tooltip. */
  label: string;
  /** The icon (e.g. a lucide-react icon at size 14–16). */
  children: ReactNode;
  size?: 'sm' | 'md';
  /** Pressed/selected look. */
  active?: boolean;
}

export function IconButton({ label, children, size = 'md', active, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg',
        'disabled:pointer-events-none disabled:opacity-50',
        size === 'sm' ? 'size-5' : 'size-7',
        active && 'bg-active text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
