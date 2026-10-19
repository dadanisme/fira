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

  // Inline comments (docs). All optional; omit them and the editor has no comment UI.
  /** Threads to highlight, located by searching quote + context in the document text. */
  comments?: readonly CommentAnchor[];
  /** Highlighted more strongly. */
  activeCommentId?: string | null;
  /** Clicking a highlight. */
  onCommentClick?(id: string): void;
  /** Vertical offset (px from the editor top) of each located thread; orphaned threads are absent. */
  onCommentPositions?(tops: Record<string, number>): void;
  /** Shows "Comment" in the selection bubble menu; receives the selected quote with ≤ 32 chars of context. */
  onComment?(anchor: Omit<CommentAnchor, 'id'>): void;

  // Heading folding and outline (page variant only).
  /** Enables folding sections by heading; folds are kept on this device under this id (e.g. the page id). Read once. */
  foldStateKey?: string;
  /** The document's top-level headings in order, debounced (needs `foldStateKey`). */
  onOutline?(headings: OutlineHeading[]): void;
}

/** A top-level heading, for a table of contents. */
export interface OutlineHeading {
  /** Stable while the heading text is unchanged (text + occurrence index); pass to `revealHeading`. */
  id: string;
  level: number;
  text: string;
  folded: boolean;
}

/** A comment thread's anchor in the document's plain text. */
export interface CommentAnchor {
  id: string;
  quote: string;
  prefix: string;
  suffix: string;
}

export interface MarkdownEditorHandle {
  focus(): void;
  /** Unfolds the sections hiding a heading (see `onOutline`) and returns its element, e.g. to scroll to it. */
  revealHeading(id: string): HTMLElement | null;
  /** Unfolds the section hiding a comment thread's highlight, so it can be scrolled into view. */
  revealComment(id: string): void;
}

/** Read-only rendering of stored Markdown (same styles as the editor). */
export interface MarkdownViewProps {
  value: string;
  variant?: 'compact' | 'page';
  className?: string;
}

const loadEditor = () => import('./markdown/MarkdownEditorImpl');
const Editor = lazy(loadEditor);
const View = lazy(() => import('./markdown/MarkdownViewImpl'));

/** Starts loading the editor chunk (e.g. on hover of a link to a page), so it opens instantly. */
export function preloadMarkdownEditor(): void {
  void loadEditor();
}

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
