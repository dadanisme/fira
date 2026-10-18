import type { Actor, Page, PageVersion } from './types.js';

/** A save starts a new version "session" after this much time since the latest snapshot. */
export const VERSION_SESSION_GAP_MS = 10 * 60 * 1000;

/**
 * Whether a save by `actor` should write a version snapshot (of the state being
 * saved): no snapshot yet, the latest is older than the session gap, or it was
 * written by a different actor. API writes always snapshot regardless.
 */
export function startsVersionSession(
  latest: Pick<PageVersion, 'savedAt' | 'actor'> | null | undefined,
  actor: Actor,
  now: number = Date.now(),
): boolean {
  if (!latest) return true;
  if (latest.actor.type !== actor.type || latest.actor.id !== actor.id) return true;
  return now - Date.parse(latest.savedAt) > VERSION_SESSION_GAP_MS;
}

/** `rootId` followed by all its descendants (depth-first). */
export function subtreeIds(pages: readonly Pick<Page, 'id' | 'parentId'>[], rootId: string): string[] {
  const children = new Map<string, string[]>();
  for (const p of pages) {
    if (p.parentId) children.set(p.parentId, [...(children.get(p.parentId) ?? []), p.id]);
  }
  const out: string[] = [];
  const visit = (id: string) => {
    out.push(id);
    children.get(id)?.forEach(visit);
  };
  visit(rootId);
  return out;
}
