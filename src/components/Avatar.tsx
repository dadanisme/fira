import { useState } from 'react';
import type { Actor } from '@shared/types';
import { actorName } from '@shared/actors';
import { colorFor } from '@shared/labels';
import { cx } from '../lib/cx';

export interface AvatarProps {
  actor: Actor;
  /** Size in design px (16 = 1rem; rendered in rem so it follows the root font size); default 18. */
  size?: number;
  className?: string;
  /** Profile photo; falls back to initials when missing or it fails to load. */
  photoURL?: string;
  /** Tooltip; defaults to the actor's name. */
  title?: string;
}

/** Initials avatar (or photo). Users are round, API tokens (agents) are rounded squares. */
export function Avatar({ actor, size = 18, className, photoURL, title }: AvatarProps) {
  const [failed, setFailed] = useState<string | null>(null);
  const color = colorFor(actor.id);
  const initials = actor.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
  return (
    <span
      title={title ?? (actor.type === 'token' ? `${actorName(actor)} (API)` : actor.name)}
      className={cx(
        'inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold select-none',
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
      {photoURL && failed !== photoURL ? (
        <img src={photoURL} alt="" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setFailed(photoURL)} />
      ) : (
        initials || '?'
      )}
    </span>
  );
}
