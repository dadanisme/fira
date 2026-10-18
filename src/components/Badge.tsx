import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import type { LabelColor } from '@shared/types';
import { cx } from '../lib/cx';

export interface BadgeProps {
  color?: LabelColor;
  children: ReactNode;
  /** Shows a remove (×) button. */
  onRemove?: () => void;
  className?: string;
}

/** Small colored pill, used for labels, tags and token names. */
export function Badge({ color = 'gray', children, onRemove, className }: BadgeProps) {
  return (
    <span
      className={cx('inline-flex h-[18px] max-w-full items-center gap-0.5 rounded px-1.5 text-[11px] leading-none font-medium', className)}
      style={{ background: `var(--label-${color}-bg)`, color: `var(--label-${color}-fg)` }}
    >
      <span className="truncate">{children}</span>
      {onRemove && (
        <button type="button" aria-label="Remove" onClick={onRemove} className="-mr-1 rounded-sm opacity-60 hover:opacity-100">
          <X size={12} />
        </button>
      )}
    </span>
  );
}
