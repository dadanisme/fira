import { useEffect, useRef, useState } from 'react';
import type { Card } from '@shared/types';
import { MarkdownEditor } from '../../../components/MarkdownEditor';
import { Button } from '../../../components/Button';
import { patchCard, useBoardData } from '../context';
import { blurActive, useLatest } from '../hooks';

const SAVE_DELAY_MS = 800;

/**
 * Card description: always-editable Markdown with debounced, optimistic saves
 * (updateCard bumps descriptionVersion and logs a `description` activity entry).
 * If the description changes elsewhere while you edit, a notice lets you pick a side
 * instead of silently overwriting either.
 */
export function Description({ card }: { card: Card }) {
  const data = useBoardData();
  const latest = useLatest({ card, data });
  const [local, setLocal] = useState(card.description);
  const [focused, setFocused] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  /** Texts we saved or adopted; anything else arriving is a change made elsewhere. */
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set([card.description]));
  const pending = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const remoteChanged = !seen.has(card.description);
  const editing = focused || dirty;
  const conflict = remoteChanged && editing;
  const seenRef = useLatest(seen);

  const adopt = (text: string) => setSeen((s) => new Set(s).add(text));

  // Adopt remote changes while idle.
  useEffect(() => {
    if (remoteChanged && !focused && !dirty) {
      setSeen(new Set([card.description]));
      setLocal(card.description);
    }
  }, [remoteChanged, focused, dirty, card.description]);

  const save = (text: string) => {
    const { card: c, data: d } = latest.current;
    adopt(text);
    if (text !== c.description) patchCard(d, c, { description: text });
  };

  const flush = () => {
    clearTimeout(timer.current);
    const text = pending.current;
    if (text === null) return;
    // Hold the save while a conflict is unresolved.
    if (!seenRef.current.has(latest.current.card.description)) return;
    pending.current = null;
    setDirty(false);
    save(text);
  };
  const flushRef = useLatest(flush);
  useEffect(() => () => flushRef.current(), [flushRef]);

  const onChange = (md: string) => {
    setLocal(md);
    pending.current = md;
    setDirty(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flushRef.current(), SAVE_DELAY_MS);
  };

  const keepMine = () => {
    adopt(card.description);
    pending.current = null;
    setDirty(false);
    save(local);
  };
  const useTheirs = () => {
    clearTimeout(timer.current);
    pending.current = null;
    setDirty(false);
    setSeen(new Set([card.description]));
    setLocal(card.description);
    setEditorKey((k) => k + 1);
  };

  return (
    <div>
      {conflict && (
        <div
          role="alert"
          className="mb-2 flex items-center gap-2 rounded-md bg-[var(--label-yellow-bg)] px-2.5 py-1.5 text-sm text-[var(--label-yellow-fg)]"
        >
          <span className="flex-1">The description was changed elsewhere while you were editing.</span>
          <Button size="sm" variant="ghost" onClick={useTheirs}>
            Use theirs
          </Button>
          <Button size="sm" onClick={keepMine}>
            Keep mine
          </Button>
        </div>
      )}
      <MarkdownEditor
        key={editorKey}
        value={editing ? local : card.description}
        onChange={onChange}
        placeholder="Add a description…"
        variant="compact"
        onCancel={blurActive}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          flush();
        }}
        className="min-h-12 rounded-md px-2 py-1 text-base"
      />
    </div>
  );
}
