import type { ComponentProps } from 'react';
import { cx } from '../lib/cx';
import { cleanSlug } from './workspaceForm';

/** Slug input with the `/w/` URL prefix in front. */
export function SlugInput({
  className,
  value,
  onChange,
  ...rest
}: Omit<ComponentProps<'input'>, 'onChange' | 'value'> & { value: string; onChange: (slug: string) => void }) {
  return (
    <span
      className={cx(
        'flex h-7 min-w-0 items-center rounded-md border border-line bg-surface pl-2 text-base focus-within:border-accent focus-within:ring-2 focus-within:ring-ring',
        className,
      )}
    >
      <span className="shrink-0 font-mono text-fg-faint select-none">/w/</span>
      <input
        {...rest}
        value={value}
        onChange={(e) => onChange(cleanSlug(e.target.value))}
        maxLength={32}
        autoComplete="off"
        spellCheck={false}
        className="h-full min-w-0 flex-1 bg-transparent pr-2 font-mono text-fg outline-none placeholder:text-fg-faint"
      />
    </span>
  );
}
