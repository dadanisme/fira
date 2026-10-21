import { colorFor } from '@shared/labels';
import { cx } from '../lib/cx';

/** A workspace's tile: its initial on a color derived from the (immutable) workspace id. */
export function WorkspaceIcon({ id, name, size = 20, className }: { id: string; name: string; size?: number; className?: string }) {
  const color = colorFor(id);
  return (
    <span
      aria-hidden
      className={cx('inline-flex shrink-0 items-center justify-center rounded-md font-semibold select-none', className)}
      style={{
        width: `${size / 16}rem`,
        height: `${size / 16}rem`,
        fontSize: `${Math.round(size * 0.5) / 16}rem`,
        background: `var(--label-${color}-bg)`,
        color: `var(--label-${color}-fg)`,
      }}
    >
      {[...name.trim()][0]?.toUpperCase() ?? '?'}
    </span>
  );
}
