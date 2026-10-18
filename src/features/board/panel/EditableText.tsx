import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cx } from '../../../lib/cx';

/**
 * Click-to-edit text: looks like plain text until hovered/focused. Commits on Enter
 * or blur, reverts on Escape. Remote changes show up while not focused.
 */
export function EditableText({
  value,
  onCommit,
  placeholder = 'Empty',
  label,
  multiline,
  type = 'text',
  className,
  allowEmpty = true,
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  label: string;
  /** Wrapping textarea (Enter still commits; Shift+Enter is ignored). */
  multiline?: boolean;
  type?: 'text' | 'number' | 'url';
  className?: string;
  /** When false, an empty commit reverts instead. */
  allowEmpty?: boolean;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  const commit = () => {
    const next = type === 'number' ? draft.trim() : draft.replace(/\s+$/, '');
    if (!allowEmpty && !next.trim()) {
      setDraft(value);
      return;
    }
    if (next !== value) onCommit(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setDraft(value);
      focused.current = false;
      requestAnimationFrame(() => (e.target as HTMLElement).blur());
    }
  };

  const shared = {
    'aria-label': label,
    value: draft,
    placeholder,
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onFocus: () => (focused.current = true),
    onBlur: () => {
      if (focused.current) commit();
      focused.current = false;
    },
    onKeyDown,
    className: cx(
      'w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-fg outline-none placeholder:text-fg-faint',
      'hover:bg-hover focus:border-line focus:bg-surface',
      className,
    ),
  };

  if (multiline) {
    return <textarea {...shared} rows={1} className={cx(shared.className, 'field-sizing-content resize-none py-1')} />;
  }
  return <input {...shared} type={type === 'number' ? 'text' : type} inputMode={type === 'number' ? 'decimal' : undefined} className={cx(shared.className, 'h-7')} />;
}
