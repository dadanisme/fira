import type { Actor } from '@shared/types';
import { colorFor } from '@shared/labels';
import { cx } from '../lib/cx';

export interface AvatarProps {
  actor: Actor;
  /** Pixel size; default 18. */
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
        actor.type === 'user' ? 'rounded-full' : 'rounded-[4px]',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(8, Math.round(size * 0.42)),
        background: `var(--label-${color}-bg)`,
        color: `var(--label-${color}-fg)`,
      }}
    >
      {initials || '?'}
    </span>
  );
}
