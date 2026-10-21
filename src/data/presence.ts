import { deleteDoc, onSnapshot, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';
import { useEffect, useMemo, useRef, useState } from 'react';
import { colIn, docIn } from './db';
import { useWorkspaceId } from './workspace';

/** Someone with a page open: `workspaces/{wid}/pages/{pageId}/presence/{uid}`. */
export interface PagePresence {
  uid: string;
  name: string;
  photoURL?: string;
  /** Has typed in the last ~20 s (or still has unsaved edits). */
  editing: boolean;
  /** Last heartbeat (ISO). */
  at: string;
}

export interface PresenceUser {
  uid: string;
  name: string;
  photoURL?: string;
}

/** Heartbeat interval while the page is open and the tab visible. */
export const PRESENCE_HEARTBEAT_MS = 30_000;
/** Entries without a heartbeat for this long are ignored (closed tab, crash, hidden tab). */
export const PRESENCE_TTL_MS = 75_000;

/**
 * Announces `me` on a page and returns the *other* people currently on it, freshest
 * first. Writes: one on open, one per heartbeat (every 30 s while the tab is visible),
 * one when `editing` flips, and a delete on leave (unmount / pagehide, best effort).
 * Stale entries (no heartbeat for 75 s) are filtered out, with the server clock
 * estimated from our own entry's timestamp so a skewed local clock doesn't hide anyone.
 */
export function usePagePresence(pageId: string, me: PresenceUser, editing: boolean): PagePresence[] {
  const [entries, setEntries] = useState<{ pageId: string; list: Entry[]; skew: number }>({ pageId, list: [], skew: 0 });
  const [now, setNow] = useState(() => Date.now());
  const editingRef = useRef(editing);
  const wid = useWorkspaceId();
  const { uid, name, photoURL } = me;

  // Listen.
  useEffect(() => {
    let lastOwnAt = 0;
    let skew = 0;
    return onSnapshot(
      colIn(wid, 'pages', pageId, 'presence'),
      (snap) => {
        const list = snap.docs.map((d) => {
          const data = d.data({ serverTimestamps: 'estimate' });
          const atMs = data.at instanceof Timestamp ? data.at.toMillis() : 0;
          if (d.id === uid && !d.metadata.hasPendingWrites && atMs !== lastOwnAt) {
            // Our own write, as stamped by the server: server time ≈ local time + skew.
            lastOwnAt = atMs;
            skew = atMs - Date.now();
          }
          const presence: PagePresence = {
            uid: d.id,
            name: typeof data.name === 'string' ? data.name : 'Someone',
            photoURL: typeof data.photoURL === 'string' ? data.photoURL : undefined,
            editing: data.editing === true,
            at: new Date(atMs).toISOString(),
          };
          return { uid: presence.uid, name: presence.name, editing: presence.editing, atMs, presence };
        });
        setEntries({ pageId, list, skew });
        setNow(Date.now());
      },
      (err) => reportError(err),
    );
  }, [wid, pageId, uid]);

  // Re-evaluate staleness even when nothing changes.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  // Heartbeat + leave.
  useEffect(() => {
    const ref = docIn(wid, 'pages', pageId, 'presence', uid);
    const beat = () => {
      if (document.visibilityState !== 'visible') return;
      setDoc(ref, { uid, name, photoURL, editing: editingRef.current, at: serverTimestamp() }).catch(reportError);
    };
    const leave = () => void deleteDoc(ref).catch(() => {});
    beat();
    const id = setInterval(beat, PRESENCE_HEARTBEAT_MS);
    const onVisibility = () => document.visibilityState === 'visible' && beat();
    document.addEventListener('visibilitychange', onVisibility);
    addEventListener('pagehide', leave);
    // Back from bfcache: announce again.
    addEventListener('pageshow', beat);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      removeEventListener('pagehide', leave);
      removeEventListener('pageshow', beat);
      leave();
    };
  }, [wid, pageId, uid, name, photoURL]);

  // Announce editing flips right away (the heartbeat effect covers the initial value).
  const announced = useRef(editing);
  useEffect(() => {
    editingRef.current = editing;
    if (announced.current === editing) return;
    announced.current = editing;
    if (document.visibilityState !== 'visible') return;
    setDoc(docIn(wid, 'pages', pageId, 'presence', uid), { uid, name, photoURL, editing, at: serverTimestamp() }).catch(reportError);
  }, [editing, wid, pageId, uid, name, photoURL]);

  return useMemo(() => {
    if (entries.pageId !== pageId) return [];
    const serverNow = now + entries.skew;
    return entries.list
      .filter((p) => p.uid !== uid && serverNow - p.atMs < PRESENCE_TTL_MS)
      .sort((a, b) => Number(b.editing) - Number(a.editing) || a.name.localeCompare(b.name))
      .map((p) => p.presence);
  }, [entries, pageId, now, uid]);
}

interface Entry {
  uid: string;
  name: string;
  editing: boolean;
  atMs: number;
  presence: PagePresence;
}
