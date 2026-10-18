import type { Page } from '@shared/types';
import { byRank, rankAfterLast, rankBetween } from '@shared/rank';

/** Tree helpers for the sidebar (pure). */

export interface FlatItem {
  id: string;
  page: Page;
  /** Parent within the section (null = section root). */
  parentId: string | null;
  depth: number;
  hasChildren: boolean;
}

/** Live (not trashed) pages of a section, keyed by their parent within the section. */
export function childrenMap(pages: readonly Page[], templates: boolean): Map<string | null, Page[]> {
  const members = pages.filter((p) => !p.trashed && p.isTemplate === templates);
  const ids = new Set(members.map((p) => p.id));
  const map = new Map<string | null, Page[]>();
  for (const p of members) {
    const parent = p.parentId && ids.has(p.parentId) ? p.parentId : null;
    map.set(parent, [...(map.get(parent) ?? []), p]);
  }
  for (const list of map.values()) list.sort(byRank);
  return map;
}

/** Visible rows, depth first. Children of collapsed pages (and of `skip`, the dragged page) are left out. */
export function flatten(children: Map<string | null, Page[]>, expanded: ReadonlySet<string>, skip?: string | null): FlatItem[] {
  const out: FlatItem[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const page of children.get(parentId) ?? []) {
      const hasChildren = (children.get(page.id)?.length ?? 0) > 0;
      out.push({ id: page.id, page, parentId, depth, hasChildren });
      if (hasChildren && expanded.has(page.id) && page.id !== skip) visit(page.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}

/** Ancestor ids of a page (nearest first). */
export function ancestors(pages: readonly Page[], id: string | undefined): Page[] {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const out: Page[] = [];
  const seen = new Set<string>();
  let current = id ? byId.get(id) : undefined;
  while (current?.parentId && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    out.push(parent);
    current = parent;
  }
  return out;
}

function arrayMove<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

export interface Projection {
  depth: number;
  parentId: string | null;
}

/** Where a dragged row would land given the row it is over and its horizontal offset (dnd-kit tree pattern). */
export function project(items: readonly FlatItem[], activeId: string, overId: string, offsetX: number, indent: number): Projection | null {
  const overIndex = items.findIndex((i) => i.id === overId);
  const activeIndex = items.findIndex((i) => i.id === activeId);
  if (overIndex < 0 || activeIndex < 0) return null;
  const active = items[activeIndex];
  const moved = arrayMove(items, activeIndex, overIndex);
  const prev = moved[overIndex - 1];
  const next = moved[overIndex + 1];
  const maxDepth = prev ? prev.depth + 1 : 0;
  const minDepth = next ? next.depth : 0;
  const depth = Math.max(minDepth, Math.min(maxDepth, active.depth + Math.round(offsetX / indent)));
  let parentId: string | null = null;
  if (depth > 0 && prev) {
    if (depth === prev.depth) parentId = prev.parentId;
    else if (depth > prev.depth) parentId = prev.id;
    else parentId = moved.slice(0, overIndex).reverse().find((i) => i.depth === depth)?.parentId ?? null;
  }
  return { depth, parentId };
}

/** The rank for the dragged page at its new place (siblings come from the full data, not just visible rows). */
export function dropRank(
  items: readonly FlatItem[],
  children: Map<string | null, Page[]>,
  activeId: string,
  overId: string,
  parentId: string | null,
): string {
  const moved = arrayMove(
    items,
    items.findIndex((i) => i.id === activeId),
    items.findIndex((i) => i.id === overId),
  ).map((i) => (i.id === activeId ? { ...i, parentId } : i));
  const visibleSiblings = moved.filter((i) => i.parentId === parentId);
  const index = visibleSiblings.findIndex((i) => i.id === activeId);
  const real = (children.get(parentId) ?? []).filter((p) => p.id !== activeId);
  if (visibleSiblings.length === 1) return rankAfterLast(real);
  const prev = visibleSiblings[index - 1];
  if (!prev) return rankBetween(null, real[0]?.rank);
  const at = real.findIndex((p) => p.id === prev.id);
  return rankBetween(real[at]?.rank, real[at + 1]?.rank);
}
