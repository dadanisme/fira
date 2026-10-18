import { badRequest } from './http.js';

export interface PageOf<T> {
  items: T[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * In-memory pagination over an already filtered and sorted list, from `limit`
 * (default 50, max 200) and the opaque `cursor` query params.
 */
export function paginate<T>(items: readonly T[], query: URLSearchParams): PageOf<T> {
  const limitParam = query.get('limit');
  const limit = limitParam === null ? DEFAULT_LIMIT : Number(limitParam);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw badRequest(`limit must be 1–${MAX_LIMIT}`);
  const offset = decodeCursor(query.get('cursor'));
  const end = offset + limit;
  return { items: items.slice(offset, end), nextCursor: end < items.length ? encodeCursor(end) : null };
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

function decodeCursor(cursor: string | null): number {
  if (!cursor) return 0;
  try {
    const { o } = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as { o: unknown };
    if (typeof o === 'number' && Number.isInteger(o) && o >= 0) return o;
  } catch {
    // fall through
  }
  throw badRequest('Invalid cursor');
}
