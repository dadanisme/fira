import {
  deleteField,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useMemo } from 'react';
import type { Card, Page, PageVersion } from '@shared/types';
import { startsVersionSession, subtreeIds } from '@shared/pages';
import { randomId } from '@shared/ids';
import { db, storage } from '../lib/firebase';
import { currentActor } from './actor';
import { cardsCol, newDoc, pagesCol, rawDoc, threadsCol, versionsCol, type Stored } from './db';
import { useLiveQuery, useLiveDoc, type Live } from './live';
import { commitInChunks } from './writes';

const allPages = query(pagesCol);

/** Every page (trashed and templates included; filter in the UI), unsorted. One listener for the whole tree. */
export function usePages(): Live<Page[]> {
  return useLiveQuery(allPages);
}

export function usePage(id: string | undefined): Live<Page | null> {
  const ref = useMemo(() => (id ? doc(pagesCol, id) : null), [id]);
  return useLiveDoc(ref);
}

/** The card a work page belongs to (`page.cardId`), for the link back to it. */
export function useLinkedCard(cardId: string | undefined): Live<Card | null> {
  const ref = useMemo(() => (cardId ? doc(cardsCol, cardId) : null), [cardId]);
  return useLiveDoc(ref);
}

/** Uploads an image embedded in a page to `pages/{pageId}/{fileId}-{name}`; resolves to its download URL. */
export async function uploadPageImage(pageId: string, file: File): Promise<string> {
  const name = file.name.replace(/[^\w.-]+/g, '_') || 'image';
  const ref = storageRef(storage, `pages/${pageId}/${randomId(10)}-${name}`);
  await uploadBytes(ref, file, { contentType: file.type || undefined });
  return getDownloadURL(ref);
}

/** Version snapshots of a page, newest first. */
export function useVersions(pageId: string | undefined): Live<PageVersion[]> {
  const q = useMemo(() => (pageId ? query(versionsCol(pageId), orderBy('savedAt', 'desc')) : null), [pageId]);
  return useLiveQuery(q);
}

export interface NewPage {
  /** Use rankAfterLast(siblings). */
  rank: string;
  title?: string;
  parentId?: string | null;
  content?: string;
  icon?: string;
  isTemplate?: boolean;
  cardId?: string;
}

/** Creates a page (version 1, with an initial snapshot); returns its id immediately. */
export function createPage(input: NewPage): string {
  const actor = currentActor();
  const ref = newDoc('pages');
  const page: Stored<Page, 'createdAt' | 'updatedAt'> = {
    title: input.title ?? '',
    icon: input.icon,
    parentId: input.parentId ?? null,
    rank: input.rank,
    content: input.content ?? '',
    version: 1,
    isTemplate: input.isTemplate ?? false,
    cardId: input.cardId,
    trashed: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: actor,
  };
  const batch = writeBatch(db);
  batch.set(ref, page);
  batch.set(newDoc('pages', ref.id, 'versions'), snapshot(1, page.title, page.content));
  batch.commit().catch(reportError);
  return ref.id;
}

/** A new page copying a template's title, icon and content. */
export function createPageFromTemplate(template: Page, input: Omit<NewPage, 'content' | 'isTemplate'>): string {
  return createPage({ title: template.title, icon: template.icon, ...input, content: template.content });
}

/** A copy of a page (title, icon, content, template flag) placed right after it; its subpages are not copied. */
export function duplicatePage(page: Page, rank: string): string {
  return createPage({
    title: page.title ? `${page.title} (copy)` : '',
    icon: page.icon,
    parentId: page.parentId,
    rank,
    content: page.content,
    isTemplate: page.isTemplate,
  });
}

/**
 * Saves title and/or content as version `page.version + 1`, where `page` is the
 * version the edit is based on. The page write applies locally at once; conflict
 * detection is the caller's job (compare the live `usePage` version with the base
 * before saving). Also writes a version snapshot of the saved state when this save
 * starts a new session (see startsVersionSession).
 */
export function savePage(page: Page, changes: { title?: string; content?: string }): Promise<void> {
  const actor = currentActor();
  const version = page.version + 1;
  const title = changes.title ?? page.title;
  const content = changes.content ?? page.content;
  const write = updateDoc(rawDoc('pages', page.id), { title, content, version, updatedAt: serverTimestamp(), updatedBy: actor });
  const snap = getDocs(query(versionsCol(page.id), orderBy('savedAt', 'desc'), limit(1))).then(({ docs }) =>
    startsVersionSession(docs[0]?.data(), actor) ? setDoc(newDoc('pages', page.id, 'versions'), snapshot(version, title, content)) : undefined,
  );
  return Promise.all([write, snap]).then(() => undefined);
}

/** Restoring a version saves its title and content as a new version. */
export function restoreVersion(page: Page, version: PageVersion): Promise<void> {
  return savePage(page, { title: version.title, content: version.content });
}

/** Non-versioned page properties (moving in the tree, icon, template flag). `null` clears the icon. */
export function updatePageMeta(
  id: string,
  patch: { parentId?: string | null; rank?: string; icon?: string | null; isTemplate?: boolean; cardId?: string },
): Promise<void> {
  const data = { ...patch, ...(patch.icon === null && { icon: deleteField() }) };
  return updateDoc(rawDoc('pages', id), data);
}

/** Trashes a page and its whole subtree (all stamped with the same `trashedAt`). */
export function trashPage(page: Page, pages: readonly Page[]): Promise<void> {
  const trashedAt = Timestamp.now();
  const ids = subtreeIds(pages, page.id).filter((id) => id === page.id || !pages.find((p) => p.id === id)?.trashed);
  return commitInChunks(ids.map((id) => (batch) => batch.update(rawDoc('pages', id), { trashed: true, trashedAt })));
}

/**
 * Restores a page and the descendants trashed with it. If its parent is still
 * trashed (or gone), the page moves to the root.
 */
export function restorePage(page: Page, pages: readonly Page[]): Promise<void> {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const ids = subtreeIds(pages, page.id).filter((id) => id === page.id || byId.get(id)?.trashedAt === page.trashedAt);
  const parent = page.parentId ? byId.get(page.parentId) : undefined;
  const orphaned = page.parentId !== null && (!parent || parent.trashed);
  return commitInChunks(
    ids.map((id) => (batch) =>
      batch.update(rawDoc('pages', id), {
        trashed: false,
        trashedAt: deleteField(),
        ...(id === page.id && orphaned && { parentId: null }),
      }),
    ),
  );
}

/** Permanently deletes a page, its subtree, and their versions and threads. */
export async function deletePageForever(page: Page, pages: readonly Page[]): Promise<void> {
  const ids = subtreeIds(pages, page.id);
  const children = await Promise.all(
    ids.flatMap((id) => [getDocs(versionsCol(id)), getDocs(threadsCol(id))]),
  );
  const refs = [...children.flatMap((snap) => snap.docs.map((d) => d.ref)), ...ids.map((id) => rawDoc('pages', id))];
  await commitInChunks(refs.map((ref) => (batch) => batch.delete(ref)));
}

function snapshot(version: number, title: string, content: string): Stored<PageVersion, 'savedAt'> {
  return { version, title, content, savedAt: serverTimestamp(), actor: currentActor() };
}
