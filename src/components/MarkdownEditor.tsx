import { lazy, Suspense, type Ref } from 'react';
import { cx } from '../lib/cx';

/**
 * Markdown editing for the whole app (card descriptions, comments, pages).
 * Markdown is the stored format; the implementation (src/components/markdown/,
 * Tiptap, owned by the docs feature) is lazy loaded so Tiptap stays out of the
 * main bundle. Import only from this file.
 */
export interface MarkdownEditorProps {
  /**
   * Markdown content. Read as the initial value; later changes replace the editor
   * content only when they differ from the last value emitted through onChange
   * (i.e. external updates such as a remote save or a version restore).
   */
  value: string;
  /** Called with the full Markdown on every change. Debounce persistence in the caller. */
  onChange(markdown: string): void;
  placeholder?: string;
  /**
   * `compact` (default): card descriptions and comments — basic formatting, Markdown
   * shortcuts, no slash menu. `page`: docs — slash menu, tables, images, task lists.
   */
  variant?: 'compact' | 'page';
  autoFocus?: boolean;
  /** Mod+Enter, e.g. submit a comment. */
  onSubmit?(): void;
  /** Escape, e.g. leave click-to-edit. */
  onCancel?(): void;
  onFocus?(): void;
  onBlur?(): void;
  /** Uploads a pasted/dropped image and resolves to its URL. Without it, images can't be added. */
  uploadImage?(file: File): Promise<string>;
  className?: string;
  ref?: Ref<MarkdownEditorHandle>;
}

export interface MarkdownEditorHandle {
  focus(): void;
}

/** Read-only rendering of stored Markdown (same styles as the editor). */
export interface MarkdownViewProps {
  value: string;
  variant?: 'compact' | 'page';
  className?: string;
}

const Editor = lazy(() => import('./markdown/MarkdownEditorImpl'));
const View = lazy(() => import('./markdown/MarkdownViewImpl'));

export function MarkdownEditor(props: MarkdownEditorProps) {
  return (
    <Suspense fallback={<Fallback text={props.value || props.placeholder} className={props.className} />}>
      <Editor {...props} />
    </Suspense>
  );
}

export function MarkdownView(props: MarkdownViewProps) {
  return (
    <Suspense fallback={<Fallback text={props.value} className={props.className} />}>
      <View {...props} />
    </Suspense>
  );
}

/** Plain-text stand-in while the editor chunk loads, to avoid layout jumps. */
function Fallback({ text, className }: { text?: string; className?: string }) {
  return <div className={cx('whitespace-pre-wrap text-fg-muted', className)}>{text}</div>;
}
