import { cx } from '../lib/cx';

export interface LogoProps {
  /** Width and height in design px (16 = 1rem, rendered in rem). Below 28 the pixel-tuned small variant is used. */
  size?: number;
  /** Accessible name; omit when a visible "fira" wordmark sits next to it. */
  title?: string;
  className?: string;
}

/**
 * The fira mark: a lowercase "f" built from kanban cards, with the active card in the brand accent.
 * Neutral parts follow currentColor. Sources: brand/fira-mark.svg (large), public/favicon.svg (small).
 */
export function Logo({ size = 20, title, className }: LogoProps) {
  const small = size < 28;
  return (
    <svg
      viewBox={small ? '0 0 16 16' : '0 0 64 64'}
      width={`${size / 16}rem`}
      height={`${size / 16}rem`}
      className={cx('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {small ? (
        <>
          <g fill="currentColor">
            <path d="M4 15.4V5A5 5 0 0 1 9 0V3A2 2 0 0 0 7 5V15.4A.6 .6 0 0 1 6.4 16H4.6A.6 .6 0 0 1 4 15.4Z" />
            <path d="M10 0H14.4A.6 .6 0 0 1 15 .6V2.4A.6 .6 0 0 1 14.4 3H10Z" />
            <path d="M3 7V10H1.6A.6 .6 0 0 1 1 9.4V7.6A.6 .6 0 0 1 1.6 7Z" />
            <rect x="8" y="7" width="3" height="3" />
            <path d="M12 7H14.4A.6 .6 0 0 1 15 7.6V9.4A.6 .6 0 0 1 14.4 10H12Z" />
          </g>
          <rect x="4" y="7" width="3" height="3" fill="var(--brand)" />
        </>
      ) : (
        <>
          <g fill="currentColor">
            <path d="M20 25V17A16 16 0 0 1 36 1V11A6 6 0 0 0 30 17V25Z" />
            <path d="M38 1H52A2 2 0 0 1 54 3V9A2 2 0 0 1 52 11H38Z" />
            <path d="M18 27V37H12A2 2 0 0 1 10 35V29A2 2 0 0 1 12 27Z" />
            <rect x="32" y="27" width="10" height="10" />
            <path d="M44 27H52A2 2 0 0 1 54 29V35A2 2 0 0 1 52 37H44Z" />
            <path d="M20 39H30V61A2 2 0 0 1 28 63H22A2 2 0 0 1 20 61Z" />
          </g>
          <rect x="20" y="27" width="10" height="10" fill="var(--brand)" />
        </>
      )}
    </svg>
  );
}
