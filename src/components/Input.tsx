import type { ComponentProps } from 'react';
import { cx } from '../lib/cx';

/** Width comes from the parent (stretches in a flex column) or className (w-full, flex-1, w-24). */
export interface InputProps extends ComponentProps<'input'> {
  /** `ghost`: borderless until hover/focus, for click-to-edit fields. */
  variant?: 'default' | 'ghost';
}

export function Input({ variant = 'default', className, ...rest }: InputProps) {
  return (
    <input
      className={cx(
        'h-7 min-w-0 rounded-md bg-transparent px-2 text-base text-fg placeholder:text-fg-faint outline-none',
        variant === 'default'
          ? 'border border-line bg-surface focus:border-accent focus:ring-2 focus:ring-ring'
          : 'border border-transparent hover:bg-hover focus:border-line focus:bg-surface',
        className,
      )}
      {...rest}
    />
  );
}
