import type { Page } from '@shared/types';
import { byRank, rankAfterLast, rankBetween } from '@shared/rank';
import { createPage, createPageFromTemplate, duplicatePage } from '../../data/pages';

function siblings(pages: readonly Page[], parentId: string | null, isTemplate: boolean): Page[] {
  return pages.filter((p) => !p.trashed && p.parentId === parentId && p.isTemplate === isTemplate).sort(byRank);
}

/** New empty page (or template) at the end of `parentId`'s children; returns its id. */
export function addPage(pages: readonly Page[], parentId: string | null, isTemplate = false): string {
  return createPage({ parentId, isTemplate, rank: rankAfterLast(siblings(pages, parentId, isTemplate)) });
}

/** New page from a template, at the end of `parentId`'s children. */
export function addPageFromTemplate(pages: readonly Page[], template: Page, parentId: string | null): string {
  return createPageFromTemplate(template, { parentId, rank: rankAfterLast(siblings(pages, parentId, false)) });
}

/** Copy placed right after the original. */
export function duplicate(pages: readonly Page[], page: Page): string {
  const list = siblings(pages, page.parentId, page.isTemplate);
  const next = list[list.findIndex((p) => p.id === page.id) + 1];
  return duplicatePage(page, rankBetween(page.rank, next?.rank));
}

export function pageTitle(page: Pick<Page, 'title'> | null | undefined): string {
  return page?.title.trim() || 'Untitled';
}
