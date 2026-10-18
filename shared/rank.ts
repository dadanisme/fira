import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

/**
 * Ordering via fractional indexing. Ranks must be compared with plain string
 * comparison (`compareRank`), never `localeCompare`.
 */

export function compareRank(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function byRank<T extends { rank: string }>(a: T, b: T): number {
  return compareRank(a.rank, b.rank);
}

/** A rank strictly between `before` and `after` (either may be null for the ends). */
export function rankBetween(before: string | null | undefined, after: string | null | undefined): string {
  return generateKeyBetween(before ?? null, after ?? null);
}

/** `n` ascending ranks between `before` and `after`. */
export function ranksBetween(before: string | null | undefined, after: string | null | undefined, n: number): string[] {
  return generateNKeysBetween(before ?? null, after ?? null, n);
}

/** A rank after the last of `items` (append). */
export function rankAfterLast(items: readonly { rank: string }[]): string {
  return rankBetween(maxRank(items), null);
}

/** A rank before the first of `items` (prepend). */
export function rankBeforeFirst(items: readonly { rank: string }[]): string {
  return rankBetween(null, minRank(items));
}

/**
 * Rank for inserting at `index` into `sorted` (ascending by rank, *excluding* the
 * item being moved). Use for drag and drop.
 */
export function rankAtIndex(sorted: readonly { rank: string }[], index: number): string {
  return rankBetween(sorted[index - 1]?.rank, sorted[index]?.rank);
}

function maxRank(items: readonly { rank: string }[]): string | null {
  return items.reduce<string | null>((max, i) => (max === null || i.rank > max ? i.rank : max), null);
}

function minRank(items: readonly { rank: string }[]): string | null {
  return items.reduce<string | null>((min, i) => (min === null || i.rank < min ? i.rank : min), null);
}
