import type { ComponentProps } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from '../lib/cx';

/** Styled native select (accessible, keyboard friendly). Width from className or the parent. */
export function Select({ className, children, ...rest }: ComponentProps<'select'>) {
  return (
    <span className={cx('relative inline-flex min-w-0', className)}>
      <select
        className={cx(
          'h-7 w-full min-w-0 appearance-none rounded-md border border-line bg-surface pr-7 pl-2 text-base text-fg outline-none',
          'focus:border-accent focus:ring-2 focus:ring-ring disabled:opacity-50',
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown size="0.875rem" className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-fg-faint" />
    </span>
  );
}
