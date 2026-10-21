import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { X } from 'lucide-react';
import { Extension, type Editor } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { EditorContent, useEditor } from '@tiptap/react';
import { Dropcursor, Gapcursor, Placeholder, UndoRedo } from '@tiptap/extensions';
import { cx } from '../../lib/cx';
import type { MarkdownEditorProps, OutlineHeading } from '../MarkdownEditor';
import { uploadErrorMessage } from '../../data/uploads';
import { inAppPath } from './appLinks';
import { CardMentions } from './cardMentions';
import { CommentHighlights, commentHighlightsKey, setCommentHighlights } from './commentHighlights';
import { HeadingFolds, revealHeading, revealPos } from './headingFolds';
import { schemaExtensions } from './schema';
import { SlashCommand } from './slashCommand';
import { SlashMenu } from './SlashMenu';
import { applyExternal } from './applyExternal';
import { anchorForRange, buildTextIndex } from './textIndex';
import { FormatBubble, TableBubble } from './Toolbars';
import './markdown.css';

function imageFiles(list: FileList | null | undefined): File[] {
  return [...(list ?? [])].filter((f) => f.type.startsWith('image/'));
}

export default function MarkdownEditorImpl(props: MarkdownEditorProps) {
  const { value, variant = 'compact', autoFocus, className, ref, uploadImage, onComment } = props;
  const latest = useRef(props);
  latest.current = props;
  const lastEmitted = useRef(value);
  const slashKeys = useRef<((e: KeyboardEvent) => boolean) | null>(null);
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const [uploading, setUploading] = useState(0);
  const [uploadErrors, setUploadErrors] = useState<{ id: number; message: string }[]>([]);
  const nextErrorId = useRef(1);
  const editorRef = useRef<Editor | null>(null);
  const isPage = variant === 'page';
  // The editor (and its plugin views) is created during render, before this component
  // mounts; callbacks that set parent state wait for the mount (see the effect below).
  const mounted = useRef(false);
  const pendingTops = useRef<Record<string, number> | null>(null);
  const pendingOutline = useRef<OutlineHeading[] | null>(null);

  const insertImages = useCallback((files: File[], pos?: number) => {
    const upload = latest.current.uploadImage;
    const editor = editorRef.current;
    if (!upload || !editor || files.length === 0) return;
    for (const file of files) {
      setUploading((n) => n + 1);
      upload(file)
        .then((src) => {
          const at = Math.min(pos ?? editor.state.selection.to, editor.state.doc.content.size);
          editor.chain().focus().insertContentAt(at, { type: 'image', attrs: { src, alt: file.name.replace(/\.[^.]+$/, '') } }).run();
        })
        .catch((err: unknown) => {
          console.error(err);
          const id = nextErrorId.current++;
          setUploadErrors((list) => [...list.slice(-2), { id, message: uploadErrorMessage(err, file) }]);
          setTimeout(() => setUploadErrors((list) => list.filter((e) => e.id !== id)), 8000);
        })
        .finally(() => setUploading((n) => n - 1));
    }
  }, []);

  const extensions = useMemo(
    () => [
      ...schemaExtensions(),
      Dropcursor.configure({ color: 'var(--accent)', width: 2 }),
      Gapcursor,
      UndoRedo,
      Placeholder.configure({
        placeholder: ({ node, editor }) =>
          editor.isEmpty ? (latest.current.placeholder ?? (isPage ? "Write, or type '/' for commands…" : '')) : node.type.name === 'paragraph' && isPage ? "Type '/' for commands" : '',
        showOnlyCurrent: true,
      }),
      CardMentions.configure({ open: (href) => void navigateRef.current(href) }),
      CommentHighlights.configure({
        onClick: (id) => latest.current.onCommentClick?.(id),
        onPositions: (tops) => {
          if (mounted.current) latest.current.onCommentPositions?.(tops);
          else pendingTops.current = tops;
        },
      }),
      ...(isPage ? [SlashCommand.configure({ onKeyDown: (e) => slashKeys.current?.(e) ?? false })] : []),
      ...(isPage && props.foldStateKey
        ? [
            HeadingFolds.configure({
              storageKey: `fira:folds:${props.foldStateKey}`,
              onOutline: (outline) => {
                if (mounted.current) latest.current.onOutline?.(outline);
                else pendingOutline.current = outline;
              },
            }),
          ]
        : []),
      Extension.create({
        name: 'firaKeys',
        addKeyboardShortcuts: () => ({
          'Mod-Enter': () => {
            const { onSubmit } = latest.current;
            onSubmit?.();
            return !!onSubmit;
          },
          Escape: () => {
            const { onCancel } = latest.current;
            onCancel?.();
            return !!onCancel;
          },
        }),
        addProseMirrorPlugins: () => [
          new Plugin({
            props: {
              // In-app links (pages, cards, workspace-relative ones resolved in this workspace):
              // a click navigates in place, Mod-click opens a new tab, Alt-click edits.
              // External links are opened by LinkClicks (schema).
              handleClick: (view, _pos, event) => {
                if (event.button !== 0 || event.altKey) return false;
                const a = (event.target as HTMLElement | null)?.closest?.('a[href]');
                if (!(a instanceof HTMLAnchorElement) || a.dataset.cardKey || !view.dom.contains(a)) return false;
                const path = inAppPath(a.getAttribute('href'));
                if (path === null) return false;
                if (event.metaKey || event.ctrlKey) window.open(path, '_blank', 'noopener');
                else void navigateRef.current(path);
                return true;
              },
              handleDOMEvents: {
                // Links never follow their href natively (handled above / by LinkClicks); external
                // ones also open on Mod-click. Card chips are handled by CardMentions.
                click: (view: EditorView, event: MouseEvent) => {
                  const a = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
                  if (!a || a.dataset.cardKey) return false;
                  event.preventDefault();
                  if (inAppPath(a.getAttribute('href')) !== null) return true;
                  if (event.metaKey || event.ctrlKey || !view.editable) window.open(a.href, '_blank', 'noopener');
                  return true;
                },
              },
              handlePaste: (_view, event) => {
                const files = imageFiles(event.clipboardData?.files);
                if (files.length === 0 || !latest.current.uploadImage) return false;
                insertImages(files);
                return true;
              },
              handleDrop: (view, event, _slice, moved) => {
                if (moved) return false;
                const files = imageFiles(event.dataTransfer?.files);
                if (files.length === 0 || !latest.current.uploadImage) return false;
                event.preventDefault();
                insertImages(files, view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos);
                return true;
              },
            },
          }),
        ],
      }),
    ],
    // The schema and plugins are fixed per editor instance; callbacks go through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const editor = useEditor({
    extensions,
    content: value,
    contentType: 'markdown',
    autofocus: autoFocus ? 'end' : false,
    editorProps: { attributes: { class: cx('md', isPage ? 'md-page' : 'md-compact', 'outline-none') } },
    onUpdate: ({ editor: e }) => {
      const md = e.getMarkdown();
      if (md === lastEmitted.current) return;
      lastEmitted.current = md;
      latest.current.onChange(md);
    },
    onFocus: () => latest.current.onFocus?.(),
    onBlur: () => latest.current.onBlur?.(),
  });
  editorRef.current = editor;

  useEffect(() => {
    mounted.current = true;
    if (pendingTops.current) {
      latest.current.onCommentPositions?.(pendingTops.current);
      pendingTops.current = null;
    }
    if (pendingOutline.current) {
      latest.current.onOutline?.(pendingOutline.current);
      pendingOutline.current = null;
    }
    return () => {
      mounted.current = false;
    };
  }, []);

  // External value changes (remote save, version restore, template) replace the content.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    applyExternal(editor, value);
  }, [editor, value]);

  const commentsKey = JSON.stringify(props.comments ?? []);
  useEffect(() => {
    setCommentHighlights(editor.view, { anchors: JSON.parse(commentsKey) });
  }, [editor, commentsKey]);

  useEffect(() => {
    setCommentHighlights(editor.view, { activeId: props.activeCommentId ?? null });
  }, [editor, props.activeCommentId]);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editor.commands.focus(),
      revealHeading: (id) => revealHeading(editor.view, id),
      revealComment: (id) => {
        const range = commentHighlightsKey.getState(editor.state)?.ranges.get(id);
        if (range) revealPos(editor.view, range.from);
      },
    }),
    [editor],
  );

  const fileInput = useRef<HTMLInputElement>(null);
  const pickImage = useMemo(() => (uploadImage ? () => fileInput.current?.click() : undefined), [uploadImage]);

  const comment = onComment
    ? () => {
        const { from, to } = editor.state.selection;
        const anchor = anchorForRange(buildTextIndex(editor.state.doc), from, to);
        if (!anchor) return;
        latest.current.onComment?.(anchor);
        editor.commands.setTextSelection(to);
      }
    : undefined;

  return (
    <div className={cx('relative', className)}>
      <EditorContent editor={editor} />
      <FormatBubble editor={editor} onComment={comment} />
      {isPage && <TableBubble editor={editor} />}
      {isPage && <SlashMenu editor={editor} keyHandler={slashKeys} pickImage={pickImage} />}
      {uploadImage && (
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            insertImages(imageFiles(e.target.files));
            e.target.value = '';
          }}
        />
      )}
      {uploading > 0 && <div className="pointer-events-none mt-1 text-sm text-fg-faint">Uploading image…</div>}
      {uploadErrors.length > 0 && (
        <div role="alert" className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 flex-col gap-2">
          {uploadErrors.map((e) => (
            <div key={e.id} className="pointer-events-auto flex items-start gap-2 rounded-lg bg-surface px-3 py-2 text-base shadow-popover">
              <span className="min-w-0 flex-1 text-danger">{e.message}</span>
              <button
                type="button"
                aria-label="Dismiss"
                onClick={() => setUploadErrors((list) => list.filter((x) => x.id !== e.id))}
                className="rounded text-fg-faint hover:text-fg"
              >
                <X size="0.875rem" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
