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
import type { Card, Page, PageAttachment, PageVersion } from '@shared/types';
import { startsVersionSession, subtreeIds } from '@shared/pages';
import { LIMITS, pageAttachmentPath } from '@shared/workspaces';
import { db, storage } from '../lib/firebase';
import { currentActor } from './actor';
import { cardsCol, colIn, docIn, newDoc, newDocIn, pagesCol, rawDoc, threadsCol, versionsCol, type Stored } from './db';
import { useLiveQuery, useLiveDoc, type Live } from './live';
import { savePageIfCurrent, type PageSaveOptions, type PageSaveResult } from './pageSave';
import { commitInChunks } from './writes';
import { currentWorkspaceId, useWorkspaceId } from './workspace';

export type { PageSaveResult, PageState } from './pageSave';

/** Every page of the workspace (trashed and templates included; filter in the UI), unsorted. One listener for the whole tree. */
export function usePages(): Live<Page[]> {
  const wid = useWorkspaceId();
  const q = useMemo(() => query(pagesCol(wid)), [wid]);
  return useLiveQuery(q);
}

export function usePage(id: string | undefined): Live<Page | null> {
  const wid = useWorkspaceId();
  const ref = useMemo(() => (id ? doc(pagesCol(wid), id) : null), [id, wid]);
  return useLiveDoc(ref);
}

/** The card a work page belongs to (`page.cardId`), for the link back to it. */
export function useLinkedCard(cardId: string | undefined): Live<Card | null> {
  const wid = useWorkspaceId();
  const ref = useMemo(() => (cardId ? doc(cardsCol(wid), cardId) : null), [cardId, wid]);
  return useLiveDoc(ref);
}

/**
 * Uploads an image embedded in a page to `workspaces/{wid}/pages/{pageId}/{attachmentId}/{name}`
 * and records it in the page's `attachments` (like `POST /pages/{id}/attachments`); resolves to
 * its non-expiring download URL. Rejects with "Files are limited to 10 MB" before uploading a
 * larger file.
 */
export async function uploadPageImage(pageId: string, file: File): Promise<string> {
  if (file.size > LIMITS.fileBytes) throw new Error('Files are limited to 10 MB');
  const wid = currentWorkspaceId();
  const name = file.name.replace(/[^\w.-]+/g, '_') || 'image';
  const entry = newDocIn(wid, 'pages', pageId, 'attachments');
  const storagePath = pageAttachmentPath(wid, pageId, entry.id, name);
  const contentType = file.type || 'application/octet-stream';
  const ref = storageRef(storage, storagePath);
  await uploadBytes(ref, file, { contentType });
  const url = await getDownloadURL(ref);
  const attachment: Stored<PageAttachment, 'createdAt'> = {
    name,
    size: file.size,
    contentType,
    storagePath,
    url,
    uploadedBy: currentActor(),
    createdAt: serverTimestamp(),
  };
  setDoc(entry, attachment).catch(reportError);
  return url;
}

/** Version snapshots of a page, newest first. */
export function useVersions(pageId: string | undefined): Live<PageVersion[]> {
  const wid = useWorkspaceId();
  const q = useMemo(() => (pageId ? query(versionsCol(pageId, wid), orderBy('savedAt', 'desc')) : null), [pageId, wid]);
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
 * Unconditional save of title and/or content as version `page.version + 1` (applies
 * locally at once, queues offline). It can overwrite a concurrent save made after
 * `page` was read; prefer `savePageVersioned`, which the docs UI uses.
 * @deprecated Use savePageVersioned.
 */
export function savePage(page: Page, changes: { title?: string; content?: string }): Promise<void> {
  const actor = currentActor();
  const wid = currentWorkspaceId();
  const version = page.version + 1;
  const title = changes.title ?? page.title;
  const content = changes.content ?? page.content;
  const write = updateDoc(docIn(wid, 'pages', page.id), { title, content, version, updatedAt: serverTimestamp(), updatedBy: actor });
  const snap = getDocs(query(versionsCol(page.id, wid), orderBy('savedAt', 'desc'), limit(1))).then(({ docs }) =>
    startsVersionSession(docs[0]?.data(), actor) ? setDoc(newDocIn(wid, 'pages', page.id, 'versions'), snapshot(version, title, content)) : undefined,
  );
  return Promise.all([write, snap]).then(() => undefined);
}

/**
 * Saves title + content as `baseVersion + 1` only if the page is still at `baseVersion`
 * (a transaction; see savePageIfCurrent). Resolves `{ ok: false, current }` when someone
 * else saved first. Needs the server: offline it rejects with code `unavailable`.
 */
export function savePageVersioned(
  pageId: string,
  baseVersion: number,
  next: { title: string; content: string },
  opts?: PageSaveOptions,
): Promise<PageSaveResult> {
  return savePageIfCurrent(db, currentWorkspaceId(), pageId, baseVersion, next, currentActor(), opts);
}

/**
 * `savePageVersioned` in a given workspace rather than the active one, for saves that can
 * outlive a workspace switch (autosave flushes on unmount, after the next workspace is
 * already active).
 */
export function savePageVersionedIn(
  workspaceId: string,
  pageId: string,
  baseVersion: number,
  next: { title: string; content: string },
  opts?: PageSaveOptions,
): Promise<PageSaveResult> {
  return savePageIfCurrent(db, workspaceId, pageId, baseVersion, next, currentActor(), opts);
}

/**
 * Restoring a version saves its title and content as a new version on top of whatever
 * is current (snapshotting the replaced state first if it has no snapshot).
 */
export function restoreVersion(page: Page, version: PageVersion): Promise<void> {
  return savePageVersioned(page.id, page.version, { title: version.title, content: version.content }, { force: true, snapshot: true }).then(
    () => undefined,
  );
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

/** Permanently deletes a page, its subtree, and their versions, threads and presence entries. */
export async function deletePageForever(page: Page, pages: readonly Page[]): Promise<void> {
  const wid = currentWorkspaceId();
  const ids = subtreeIds(pages, page.id);
  const children = await Promise.all(
    ids.flatMap((id) => [getDocs(versionsCol(id, wid)), getDocs(threadsCol(id, wid)), getDocs(colIn(wid, 'pages', id, 'presence'))]),
  );
  const refs = [...children.flatMap((snap) => snap.docs.map((d) => d.ref)), ...ids.map((id) => docIn(wid, 'pages', id))];
  await commitInChunks(refs.map((ref) => (batch) => batch.delete(ref)));
}

function snapshot(version: number, title: string, content: string): Stored<PageVersion, 'savedAt'> {
  return { version, title, content, savedAt: serverTimestamp(), actor: currentActor() };
}
