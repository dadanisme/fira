import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';
import type { Actor } from '@shared/types';
import { startsVersionSession } from '@shared/pages';

/**
 * Conditional ("compare-and-set") page saves. Takes the Firestore instance as a
 * parameter so it runs unchanged against the emulator in scripts/page-save-check.ts;
 * the SPA calls it through `savePageVersioned` in ./pages. Pages live at
 * `workspaces/{workspaceId}/pages/{pageId}`.
 */

/** The versioned part of a page as stored on the server. */
export interface PageState {
  version: number;
  title: string;
  content: string;
  updatedBy: Actor;
}

export type PageSaveResult =
  /** Saved as `version` (or nothing to write: the server already holds exactly this title + content). */
  | { ok: true; version: number }
  /** The page moved past the base version; nothing was written. */
  | { ok: false; current: PageState };

export interface PageSaveOptions {
  /** Skip the version check and save on top of whatever is current (version restore). */
  force?: boolean;
  /**
   * Always start a new version session, i.e. snapshot the saved state (and the overwritten
   * one, when it has no snapshot yet). Used by "keep mine" and restores, so the state being
   * replaced stays recoverable from page history.
   */
  snapshot?: boolean;
}

/**
 * Saves `title` + `content` as `baseVersion + 1`, but only if the page is still at
 * `baseVersion` (Firestore transaction: the read and the write commit atomically, so
 * a concurrent save by anyone, SPA or API, makes this one fail instead of being
 * overwritten). Version snapshots follow `startsVersionSession`; when a save starts a
 * new session and the current state has no snapshot yet (e.g. someone else's last
 * edits), that state is snapshotted first, attributed to its editor.
 *
 * Transactions need the server: offline this rejects (code `unavailable`), and the
 * caller keeps the edit locally and retries.
 */
export async function savePageIfCurrent(
  db: Firestore,
  workspaceId: string,
  pageId: string,
  baseVersion: number,
  next: { title: string; content: string },
  actor: Actor,
  opts: PageSaveOptions = {},
): Promise<PageSaveResult> {
  const pageRef = doc(db, 'workspaces', workspaceId, 'pages', pageId);
  const versions = collection(pageRef, 'versions');
  // Queries can't run inside a client transaction; the latest snapshot only decides
  // whether to snapshot, so reading it just before is fine.
  const latestSnap = await getDocs(query(versions, orderBy('savedAt', 'desc'), limit(1)));
  const latestData = latestSnap.docs[0]?.data({ serverTimestamps: 'estimate' });
  const latest = latestData
    ? { version: latestData.version as number, actor: latestData.actor as Actor, savedAt: (latestData.savedAt as Timestamp).toDate().toISOString() }
    : null;

  return runTransaction(db, async (tx): Promise<PageSaveResult> => {
    const snap = await tx.get(pageRef);
    if (!snap.exists()) throw new Error(`Page ${pageId} not found`);
    const data = snap.data();
    const current: PageState = { version: data.version, title: data.title, content: data.content, updatedBy: data.updatedBy };
    if (current.title === next.title && current.content === next.content) return { ok: true, version: current.version };
    if (!opts.force && current.version !== baseVersion) return { ok: false, current };

    const version = current.version + 1;
    tx.update(pageRef, { title: next.title, content: next.content, version, updatedAt: serverTimestamp(), updatedBy: actor });
    if (opts.snapshot || startsVersionSession(latest, actor)) {
      if (latest?.version !== current.version) {
        tx.set(doc(versions), {
          version: current.version,
          title: current.title,
          content: current.content,
          savedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : Timestamp.now(),
          actor: current.updatedBy,
        });
      }
      tx.set(doc(versions), { version, title: next.title, content: next.content, savedAt: serverTimestamp(), actor });
    }
    return { ok: true, version };
  });
}
