import type { Actor } from '@shared/types';
import { colorFor } from '@shared/labels';
import { cx } from '../lib/cx';

export interface AvatarProps {
  actor: Actor;
  /** Size in design px (16 = 1rem; rendered in rem so it follows the root font size); default 18. */
  size?: number;
  className?: string;
}

/** Initials avatar. Users are round, API tokens (agents) are rounded squares. */
export function Avatar({ actor, size = 18, className }: AvatarProps) {
  const color = colorFor(actor.id);
  const initials = actor.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  return (
    <span
      title={actor.type === 'token' ? `${actor.name} (API)` : actor.name}
      className={cx(
        'inline-flex shrink-0 items-center justify-center font-semibold select-none',
        actor.type === 'user' ? 'rounded-full' : 'rounded-sm',
        className,
      )}
      style={{
        width: `${size / 16}rem`,
        height: `${size / 16}rem`,
        fontSize: `${Math.max(8, Math.round(size * 0.42)) / 16}rem`,
        background: `var(--label-${color}-bg)`,
        color: `var(--label-${color}-fg)`,
      }}
    >
      {initials || '?'}
    </span>
  );
}
