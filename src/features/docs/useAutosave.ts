import { useCallback, useEffect, useRef, useState } from 'react';
import type { Page } from '@shared/types';
import { savePage } from '../../data/pages';

const DEBOUNCE_MS = 700;

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type Field = 'title' | 'content';

export interface Autosave {
  title: string;
  content: string;
  setTitle(title: string): void;
  setContent(content: string): void;
  /** Replaces the content as if typed (e.g. applying a template); the editor picks it up as an external change. */
  replaceContent(content: string): void;
  status: SaveStatus;
  /** Set when the live page moved on (someone else saved) while overlapping local edits are unsaved. */
  conflict: Page | null;
  reloadTheirs(): void;
  keepMine(): void;
  /** Drops unsaved local edits (e.g. before restoring a version). */
  discard(): void;
}

/**
 * Debounced optimistic autosave of a page's title and content with version-based
 * conflict detection. `base` is the page state the local edits build on; each
 * save writes `base.version + 1` and advances the base, so the echo of our own
 * write is recognized. Any other change to the live page either rebases silently
 * (no overlapping unsaved edits; remote values are applied) or raises `conflict`.
 */
export function useAutosave(live: Page): Autosave {
  const base = useRef<Page>(live);
  const dirty = useRef<Record<Field, boolean>>({ title: false, content: false });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [title, setTitleState] = useState(live.title);
  const [content, setContentState] = useState(live.content);
  const draft = useRef({ title: live.title, content: live.content });
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [conflict, setConflict] = useState<Page | null>(null);
  const conflictRef = useRef<Page | null>(null);
  const liveRef = useRef(live);
  liveRef.current = live;

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (conflictRef.current) return;
    const changes: { title?: string; content?: string } = {};
    if (dirty.current.title) changes.title = draft.current.title;
    if (dirty.current.content) changes.content = draft.current.content;
    dirty.current = { title: false, content: false };
    const b = base.current;
    if ((changes.title ?? b.title) === b.title && (changes.content ?? b.content) === b.content) return;
    base.current = { ...b, ...changes, version: b.version + 1 };
    setStatus('saving');
    savePage(b, changes).then(
      () => setStatus((s) => (s === 'saving' ? 'saved' : s)),
      (err) => {
        reportError(err);
        setStatus('error');
      },
    );
  }, []);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    if (!conflictRef.current) timer.current = setTimeout(flush, DEBOUNCE_MS);
  }, [flush]);

  const edit = useCallback(
    (field: Field, value: string) => {
      draft.current[field] = value;
      dirty.current[field] = true;
      schedule();
    },
    [schedule],
  );

  const setTitle = useCallback((v: string) => (setTitleState(v), edit('title', v)), [edit]);
  const setContent = useCallback((v: string) => (setContentState(v), edit('content', v)), [edit]);

  const showConflict = (page: Page | null) => {
    conflictRef.current = page;
    setConflict(page);
  };

  const adopt = useCallback((page: Page, fields: Field[]) => {
    base.current = page;
    for (const f of fields) {
      dirty.current[f] = false;
      draft.current[f] = page[f];
    }
    if (fields.includes('title')) setTitleState(page.title);
    if (fields.includes('content')) setContentState(page.content);
  }, []);

  // React to the live page.
  useEffect(() => {
    const b = base.current;
    if (live.version === b.version && live.title === b.title && live.content === b.content) return;
    const overlapping = (['title', 'content'] as const).filter((f) => dirty.current[f] && live[f] !== b[f]);
    if (overlapping.length > 0) {
      clearTimeout(timer.current);
      showConflict(live);
      return;
    }
    // Rebase: take remote values for fields without unsaved edits.
    adopt(live, (['title', 'content'] as const).filter((f) => !dirty.current[f]));
    if (conflictRef.current) showConflict(null);
  }, [live, adopt]);

  // Flush on leave (unmount / tab hidden / unload).
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, [flush]);

  return {
    title,
    content,
    setTitle,
    setContent,
    replaceContent: setContent,
    status,
    conflict,
    reloadTheirs: () => {
      showConflict(null);
      adopt(liveRef.current, ['title', 'content']);
    },
    keepMine: () => {
      base.current = liveRef.current;
      showConflict(null);
      dirty.current = { title: draft.current.title !== liveRef.current.title, content: draft.current.content !== liveRef.current.content };
      flush();
    },
    discard: () => {
      clearTimeout(timer.current);
      dirty.current = { title: false, content: false };
      showConflict(null);
    },
  };
}
