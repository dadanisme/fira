import { useImperativeHandle, useRef, type KeyboardEvent } from 'react';
import { cx } from '../../lib/cx';
import type { MarkdownEditorProps } from '../MarkdownEditor';

// Placeholder: the docs feature replaces this with the Tiptap editor (@tiptap/markdown).
export default function MarkdownEditorImpl({
  value,
  onChange,
  placeholder,
  autoFocus,
  onSubmit,
  onCancel,
  onFocus,
  onBlur,
  className,
  ref,
}: MarkdownEditorProps) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => textarea.current?.focus() }), []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) {
      e.preventDefault();
      onSubmit();
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <textarea
      ref={textarea}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onBlur={onBlur}
      placeholder={placeholder}
      autoFocus={autoFocus}
      className={cx('field-sizing-content min-h-16 w-full resize-none bg-transparent text-fg outline-none placeholder:text-fg-faint', className)}
    />
  );
}
