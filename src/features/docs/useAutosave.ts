import { useEffect, useRef, useState } from 'react';
import { FirestoreError } from 'firebase/firestore';
import type { Page } from '@shared/types';
import { savePageVersionedIn, type PageState } from '../../data/pages';
import { useWorkspaceId } from '../../data/workspace';

const DEBOUNCE_MS = 700;
/** "Editing" (for presence) lasts this long after the last keystroke, or while edits are unsaved. */
const EDITING_MS = 20_000;
/** Retry delay after a failed or offline save (also retried on the `online` event). */
const RETRY_MS = 10_000;
/** A local draft written by another tab this recently is that tab's in-flight save: don't adopt it. */
const FOREIGN_DRAFT_MS = 10_000;

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'offline' | 'error';

type Field = 'title' | 'content';
const FIELDS = ['title', 'content'] as const;

/** Server state the local edits build on. */
interface Base {
  version: number;
  title: string;
  content: string;
}

export interface Autosave {
  title: string;
  content: string;
  setTitle(title: string): void;
  setContent(content: string): void;
  /** Replaces the content as if typed (e.g. applying a template); the editor picks it up as an external change. */
  replaceContent(content: string): void;
  status: SaveStatus;
  /**
   * Someone else's save that clashes with unsaved local edits (same field changed on
   * both sides). Autosave is paused until `loadTheirs` or `keepMine`.
   */
  conflict: PageState | null;
  /** Typed in the last 20 s or holding unsaved edits (for presence). */
  editing: boolean;
  /** Drops local edits and loads the latest saved version. */
  loadTheirs(): void;
  /** Saves local edits on top of the latest version (both end up in version history). */
  keepMine(): void;
  /** Drops unsaved local edits (e.g. before restoring a version). */
  discard(): void;
}

// ------------------------------------------------------------- local drafts
// Unsaved edits are mirrored to localStorage (on each debounced save attempt, not per
// keystroke) until the server confirms them, so they survive offline periods, reloads
// and closed tabs. A draft remembers its base, so conflicts are detected on return.

interface StoredDraft {
  base: Base;
  title: string;
  content: string;
  at: number;
  tab: string;
}

/** Per workspace and page. */
const draftKey = (wid: string, pageId: string) => `fira:page-draft:${wid}:${pageId}`;
/** Before workspaces (page ids are unique across workspaces, so a draft there is this page's). */
const legacyDraftKey = (pageId: string) => `fira:page-draft:${pageId}`;

const TAB_ID = (() => {
  const fresh = Math.random().toString(36).slice(2);
  try {
    const id = sessionStorage.getItem('fira:tab') ?? fresh;
    sessionStorage.setItem('fira:tab', id);
    return id;
  } catch {
    return fresh;
  }
})();

function readDraft(wid: string, pageId: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(wid, pageId)) ?? localStorage.getItem(legacyDraftKey(pageId));
    return raw ? (JSON.parse(raw) as StoredDraft) : null;
  } catch {
    return null;
  }
}

function writeDraft(wid: string, pageId: string, base: Base, draft: { title: string; content: string }) {
  try {
    const stored: StoredDraft = { base, ...draft, at: Date.now(), tab: TAB_ID };
    localStorage.setItem(draftKey(wid, pageId), JSON.stringify(stored));
    localStorage.removeItem(legacyDraftKey(pageId));
  } catch {
    // Storage full or blocked: the edit still lives in memory.
  }
}

function clearDraft(wid: string, pageId: string) {
  try {
    localStorage.removeItem(draftKey(wid, pageId));
    localStorage.removeItem(legacyDraftKey(pageId));
  } catch {
    // ignore
  }
}

const stateOf = (p: Page): PageState => ({ version: p.version, title: p.title, content: p.content, updatedBy: p.updatedBy });
const baseOf = (p: Base): Base => ({ version: p.version, title: p.title, content: p.content });
const newest = (a: PageState | null, b: PageState): PageState => (a && a.version >= b.version ? a : b);

function initialState(wid: string, live: Page): { base: Base; title: string; content: string; restored: boolean } {
  const fresh = { base: baseOf(live), title: live.title, content: live.content, restored: false };
  const stored = readDraft(wid, live.id);
  if (!stored) return fresh;
  if (stored.title === live.title && stored.content === live.content) {
    clearDraft(wid, live.id);
    return fresh;
  }
  if (stored.tab !== TAB_ID && Date.now() - stored.at < FOREIGN_DRAFT_MS) return fresh;
  return { base: stored.base, title: stored.title, content: stored.content, restored: true };
}

/**
 * Debounced autosave of a page's title and content, safe with several editors.
 *
 * Every save is conditional on the version the edits are based on (`savePageVersioned`,
 * a transaction), so nobody's save is silently overwritten. Remote changes (another
 * person, another tab, an API token) are applied silently when they don't touch a field
 * with unsaved local edits (field-level: a remote title change never blocks a local
 * content edit and vice versa). When they do, or a save is rejected and the same field
 * changed on both sides, autosave pauses and `conflict` is set.
 *
 * Saves need the server (transactions don't run offline): offline, edits stay in the
 * editor and in localStorage and are saved, still conditionally, once back online.
 */
export function useAutosave(live: Page): Autosave {
  // Pinned for the hook's lifetime: the flush on unmount runs after a workspace switch has
  // already made the next workspace active.
  const wid = useWorkspaceId();
  const [init] = useState(() => initialState(wid, live));
  const [title, setTitleState] = useState(init.title);
  const [content, setContentState] = useState(init.content);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [conflict, setConflictState] = useState<PageState | null>(null);
  const [editing, setEditing] = useState(init.restored);
  // Updated in the effect below, before reconciling.
  const liveRef = useRef(live);

  const [ctl] = useState(() => {
    const pageId = live.id;
    let base: Base = init.base;
    const draft = { title: init.title, content: init.content };
    let conflictState: PageState | null = null;
    let inflight = false;
    let generation = 0;
    /** Unmounted: settle the last save but schedule nothing more (a local draft carries over). */
    let stopped = false;
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    let editingTimer: ReturnType<typeof setTimeout> | undefined;

    const unsaved = (): Field[] => FIELDS.filter((f) => draft[f] !== base[f]);

    const setDraft = (f: Field, value: string) => {
      draft[f] = value;
      (f === 'title' ? setTitleState : setContentState)(value);
    };

    const setConflict = (c: PageState | null) => {
      conflictState = c;
      setConflictState(c);
    };

    const schedule = (delay = DEBOUNCE_MS) => {
      clearTimeout(saveTimer);
      saveTimer = conflictState || stopped ? undefined : setTimeout(flush, delay);
    };

    const stillEditing = () => {
      clearTimeout(editingTimer);
      if (unsaved().length > 0) editingTimer = setTimeout(stillEditing, EDITING_MS);
      else setEditing(false);
    };

    /** Moves the base to `remote`, taking its value for every field without local edits; false (and `conflict`) on a clash. */
    const rebaseOnto = (remote: PageState): boolean => {
      const clash = FIELDS.some((f) => draft[f] !== base[f] && remote[f] !== base[f] && remote[f] !== draft[f]);
      if (clash) {
        clearTimeout(saveTimer);
        setConflict(remote);
        return false;
      }
      const old = base;
      base = baseOf(remote);
      for (const f of FIELDS) if (draft[f] === old[f]) setDraft(f, remote[f]);
      if (unsaved().length > 0) schedule();
      else clearDraft(wid, pageId);
      return true;
    };

    /** Reacts to the live page (after each snapshot and after each save settles). */
    const reconcile = () => {
      if (inflight) return; // the save's outcome decides
      const remote = liveRef.current;
      if (remote.version < base.version) return; // older than what we saved
      if (remote.version === base.version && remote.title === base.title && remote.content === base.content) return;
      if (conflictState) {
        if (remote.version > conflictState.version) setConflict(stateOf(remote));
        return;
      }
      rebaseOnto(stateOf(remote));
    };

    const flush = (opts?: { snapshot?: boolean }) => {
      clearTimeout(saveTimer);
      saveTimer = undefined;
      if (unsaved().length === 0) {
        clearDraft(wid, pageId);
        return;
      }
      writeDraft(wid, pageId, base, draft);
      if (conflictState || inflight) return;
      if (!navigator.onLine) {
        setStatus('offline');
        return;
      }
      const gen = generation;
      const sent = { title: draft.title, content: draft.content };
      inflight = true;
      setStatus('saving');
      const baseVersion = base.version;
      // Through a promise, so a synchronous throw (e.g. signed out) lands in the error path.
      Promise.resolve()
        .then(() => savePageVersionedIn(wid, pageId, baseVersion, sent, opts))
        .then(
        (res) => {
          inflight = false;
          if (gen !== generation) {
            // Discarded meanwhile: whatever got saved is now the state everyone sees.
            if (res.ok) {
              base = { version: res.version, ...sent };
              for (const f of FIELDS) setDraft(f, sent[f]);
            }
          } else if (res.ok) {
            base = { version: res.version, ...sent };
            setStatus((s) => (s === 'saving' ? 'saved' : s));
            if (unsaved().length > 0) schedule();
            else clearDraft(wid, pageId);
          } else {
            setStatus('idle');
            rebaseOnto(res.current);
          }
          reconcile();
        },
        (err: unknown) => {
          inflight = false;
          const offline = !navigator.onLine || (err instanceof FirestoreError && err.code === 'unavailable');
          if (!offline) reportError(err);
          setStatus(offline ? 'offline' : 'error');
          schedule(RETRY_MS);
          reconcile();
        },
      );
    };

    const edit = (f: Field, value: string) => {
      setDraft(f, value);
      setEditing(true);
      clearTimeout(editingTimer);
      editingTimer = setTimeout(stillEditing, EDITING_MS);
      schedule();
    };

    const resetTo = (state: Base) => {
      clearTimeout(saveTimer);
      base = baseOf(state);
      for (const f of FIELDS) setDraft(f, state[f]);
      setConflict(null);
      clearDraft(wid, pageId);
      setStatus('idle');
    };

    return {
      reconcile,
      flush,
      edit,
      /** Mount: save a restored local draft (if still based on the live version; otherwise reconcile decides). */
      start: () => {
        stopped = false;
        if (init.restored) {
          setEditing(true);
          editingTimer = setTimeout(stillEditing, EDITING_MS);
          schedule(0);
        }
      },
      stop: () => {
        clearTimeout(editingTimer);
        flush();
        stopped = true;
        clearTimeout(saveTimer);
      },
      loadTheirs: () => {
        generation++;
        resetTo(newest(conflictState, stateOf(liveRef.current)));
      },
      keepMine: () => {
        const theirs = newest(conflictState, stateOf(liveRef.current));
        base = baseOf(theirs);
        setConflict(null);
        flush({ snapshot: true });
      },
      discard: () => {
        generation++;
        resetTo(base);
      },
    };
  });

  // React to the live page.
  useEffect(() => {
    liveRef.current = live;
    ctl.reconcile();
  }, [live, ctl]);

  // Save a restored draft; flush when leaving (unmount / tab hidden / pagehide) and when back online.
  useEffect(() => {
    ctl.start();
    const flush = () => ctl.flush();
    const onHide = () => document.visibilityState === 'hidden' && flush();
    addEventListener('pagehide', flush);
    addEventListener('online', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      removeEventListener('pagehide', flush);
      removeEventListener('online', flush);
      document.removeEventListener('visibilitychange', onHide);
      ctl.stop();
    };
  }, [ctl]);

  return {
    title,
    content,
    setTitle: (v) => ctl.edit('title', v),
    setContent: (v) => ctl.edit('content', v),
    replaceContent: (v) => ctl.edit('content', v),
    status,
    conflict,
    editing,
    loadTheirs: ctl.loadTheirs,
    keepMine: ctl.keepMine,
    discard: ctl.discard,
  };
}
