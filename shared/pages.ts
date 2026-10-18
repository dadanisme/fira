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

/** Pages to mark trashed when trashing `rootId`: the root plus its not-yet-trashed descendants. */
export function trashIds(pages: readonly Pick<Page, 'id' | 'parentId' | 'trashed'>[], rootId: string): string[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  return subtreeIds(pages, rootId).filter((id) => id === rootId || !byId.get(id)?.trashed);
}

/**
 * What restoring `page` touches: the page plus the descendants trashed with it (same
 * `trashedAt`), and whether the page must move to the root because its parent is
 * still trashed or gone.
 */
export function restorePlan(
  pages: readonly Pick<Page, 'id' | 'parentId' | 'trashed' | 'trashedAt'>[],
  page: Pick<Page, 'id' | 'parentId' | 'trashedAt'>,
): { ids: string[]; orphaned: boolean } {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const ids = subtreeIds(pages, page.id).filter((id) => id === page.id || byId.get(id)?.trashedAt === page.trashedAt);
  const parent = page.parentId ? byId.get(page.parentId) : undefined;
  return { ids, orphaned: page.parentId !== null && (!parent || parent.trashed) };
}

/** Whether moving `pageId` under `parentId` would create a cycle (parent is the page or a descendant). */
export function wouldCycle(pages: readonly Pick<Page, 'id' | 'parentId'>[], pageId: string, parentId: string | null): boolean {
  return parentId !== null && subtreeIds(pages, pageId).includes(parentId);
}

/** Default title of a card's work page, e.g. `NI-12 Fix login`. */
export function workPageTitle(card: { key: string; title: string }): string {
  return `${card.key} ${card.title}`;
}
