import { useCallback, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { isTextSelection, posToDOMRect } from '@tiptap/core';
import {
  Bold,
  Code,
  ExternalLink,
  Italic,
  Link2,
  Pencil,
  MessageSquarePlus,
  Strikethrough,
  Trash2,
  Unlink,
  BetweenHorizontalEnd,
  BetweenVerticalEnd,
  Rows3,
  Columns3,
} from 'lucide-react';
import { cx } from '../../lib/cx';
import { NO_HOVER, useMediaQuery } from '../../lib/useMediaQuery';
import { clearLinkTap, LINK_BUBBLE, linkTapKey, type LinkTap } from './linkTaps';

function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cx(
        'inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-1.5 text-sm text-fg-muted hover:bg-hover hover:text-fg touch:h-9 touch:min-w-9',
        active && 'bg-active text-fg',
      )}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-0.5 h-4 w-px bg-line" />;

/** A typed link target as stored: schemes, root-relative paths and anchors as written, else https. */
function normalizeHref(url: string): string {
  return /^[a-z][\w+.-]*:|^\/|^#/i.test(url) ? url : `https://${url}`;
}

/** The URL field of the link bubbles. Fits a 360px phone (the bubble is max-content wide). */
function LinkForm({
  href,
  onHref,
  onSubmit,
  onCancel,
  onRemove,
}: {
  href: string;
  onHref(href: string): void;
  onSubmit(): void;
  onCancel(): void;
  onRemove?: () => void;
}) {
  return (
    <form
      className="flex items-center gap-1 p-0.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <input
        autoFocus
        value={href}
        onChange={(e) => onHref(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        placeholder="Paste a link…"
        inputMode="url"
        className="h-6 w-56 max-w-[calc(100vw-5.5rem)] rounded bg-transparent px-1.5 text-sm text-fg outline-none placeholder:text-fg-faint"
      />
      {onRemove && (
        <ToolButton label="Remove link" onClick={onRemove}>
          <Unlink size="0.875rem" />
        </ToolButton>
      )}
    </form>
  );
}

/** Formatting bubble on a text selection: bold, italic, strike, code, link, comment. */
export function FormatBubble({ editor, onComment }: { editor: Editor; onComment?: () => void }) {
  const [linking, setLinking] = useState(false);
  const [href, setHref] = useState('');
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      linkHref: (e.getAttributes('link').href as string | undefined) ?? '',
    }),
  });

  // On touch the native selection callout (iOS) sits above the selection, so the bubble goes below.
  const touch = useMediaQuery(NO_HOVER);

  const applyLink = () => {
    const url = href.trim();
    const chain = editor.chain().focus().extendMarkRange('link');
    if (url) chain.setLink({ href: normalizeHref(url) }).run();
    else chain.unsetLink().run();
    setLinking(false);
  };

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="formatBubble"
      options={{ placement: touch ? 'bottom' : 'top', offset: touch ? 12 : 6 }}
      shouldShow={({ editor: e, state: s, from, to, view, element }) => {
        if (!view.hasFocus() && !element.contains(document.activeElement)) return false;
        if (!isTextSelection(s.selection) || from === to || e.isActive('codeBlock')) return false;
        return s.doc.textBetween(from, to).trim().length > 0;
      }}
      className="z-40 flex items-center gap-0.5 rounded-lg bg-surface p-0.5 shadow-popover"
    >
      {linking ? (
        <LinkForm
          href={href}
          onHref={setHref}
          onSubmit={applyLink}
          onCancel={() => {
            setLinking(false);
            editor.commands.focus();
          }}
          onRemove={state.link ? () => (setHref(''), editor.chain().focus().extendMarkRange('link').unsetLink().run(), setLinking(false)) : undefined}
        />
      ) : (
        <>
          <ToolButton label="Bold" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold size="0.875rem" />
          </ToolButton>
          <ToolButton label="Italic" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic size="0.875rem" />
          </ToolButton>
          <ToolButton label="Strikethrough" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <Strikethrough size="0.875rem" />
          </ToolButton>
          <ToolButton label="Inline code" active={state.code} onClick={() => editor.chain().focus().toggleCode().run()}>
            <Code size="0.875rem" />
          </ToolButton>
          <ToolButton
            label="Link"
            active={state.link}
            onClick={() => {
              setHref(state.linkHref);
              setLinking(true);
            }}
          >
            <Link2 size="0.875rem" />
          </ToolButton>
          {onComment && (
            <>
              <Divider />
              <ToolButton label="Comment" onClick={onComment}>
                <MessageSquarePlus size="0.875rem" />
                <span>Comment</span>
              </ToolButton>
            </>
          )}
        </>
      )}
    </BubbleMenu>
  );
}

/**
 * Touch only: actions for the link or card chip the caret was tapped into (see linkTaps.ts), below
 * it so the native callout doesn't cover it. Open / Edit / Remove for links, Open for card chips.
 */
const LINK_BUBBLE_OPTIONS = { placement: 'bottom', offset: 10 } as const;
const showLinkBubble = ({ state }: { state: EditorState }) => !!linkTapKey.getState(state) && state.selection.empty;

export function LinkBubble({ editor, onOpen }: { editor: Editor; onOpen: (tap: LinkTap) => void }) {
  const tap = useEditorState({ editor, selector: ({ editor: e }) => linkTapKey.getState(e.state) ?? null });
  /** The tapped link being edited (by its start), so another tap leaves edit mode. */
  const [editingAt, setEditingAt] = useState<number | null>(null);
  const [href, setHref] = useState('');
  const editing = tap !== null && editingAt === tap.from;

  // Stable props: the BubbleMenu dispatches an options update whenever one changes identity.
  const anchor = useCallback(() => {
    const t = linkTapKey.getState(editor.state);
    return t ? { getBoundingClientRect: () => posToDOMRect(editor.view, t.from, t.to) } : null;
  }, [editor]);

  const relink = (t: LinkTap, url: string) => {
    const chain = editor.chain().focus().setTextSelection({ from: t.from, to: t.to });
    (url ? chain.setLink({ href: normalizeHref(url) }) : chain.unsetLink()).setTextSelection(t.to).run();
    setEditingAt(null);
  };

  return (
    <BubbleMenu
      editor={editor}
      pluginKey={LINK_BUBBLE}
      updateDelay={0}
      options={LINK_BUBBLE_OPTIONS}
      getReferencedVirtualElement={anchor}
      shouldShow={showLinkBubble}
      className="z-40 flex max-w-[calc(100vw-1rem)] items-center gap-0.5 rounded-lg bg-surface p-0.5 shadow-popover"
    >
      {tap &&
        (editing ? (
          <LinkForm
            href={href}
            onHref={setHref}
            onSubmit={() => relink(tap, href.trim())}
            onCancel={() => setEditingAt(null)}
            onRemove={() => relink(tap, '')}
          />
        ) : (
          <>
            <ToolButton
              label={tap.cardKey ? `Open ${tap.cardKey}` : `Open ${tap.href}`}
              onClick={() => {
                clearLinkTap(editor.view);
                onOpen(tap);
              }}
            >
              <ExternalLink size="0.875rem" />
              <span className="max-w-40 truncate">{tap.cardKey ? `Open ${tap.cardKey}` : 'Open'}</span>
            </ToolButton>
            {!tap.cardKey && (
              <>
                <ToolButton
                  label="Edit link"
                  onClick={() => {
                    setHref(tap.href);
                    setEditingAt(tap.from);
                  }}
                >
                  <Pencil size="0.875rem" />
                  <span>Edit</span>
                </ToolButton>
                <ToolButton label="Remove link" onClick={() => relink(tap, '')}>
                  <Unlink size="0.875rem" />
                  <span>Remove</span>
                </ToolButton>
              </>
            )}
          </>
        ))}
    </BubbleMenu>
  );
}

/** Row/column controls while the caret is in a table. */
export function TableBubble({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableBubble"
      options={{ placement: 'top-start', offset: 8 }}
      getReferencedVirtualElement={() => {
        const { $from } = editor.state.selection;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'table') {
            const dom = editor.view.nodeDOM($from.before(d)) as HTMLElement | null;
            if (dom) return { getBoundingClientRect: () => dom.getBoundingClientRect() };
          }
        }
        return null;
      }}
      shouldShow={({ editor: e, view, state: s }) => view.hasFocus() && s.selection.empty && e.isActive('table')}
      className="z-40 flex items-center gap-0.5 rounded-lg bg-surface p-0.5 shadow-popover"
    >
      <ToolButton label="Add row below" onClick={() => editor.chain().focus().addRowAfter().run()}>
        <BetweenHorizontalEnd size="0.875rem" />
      </ToolButton>
      <ToolButton label="Add column right" onClick={() => editor.chain().focus().addColumnAfter().run()}>
        <BetweenVerticalEnd size="0.875rem" />
      </ToolButton>
      <Divider />
      <ToolButton label="Delete row" onClick={() => editor.chain().focus().deleteRow().run()}>
        <Rows3 size="0.875rem" />
      </ToolButton>
      <ToolButton label="Delete column" onClick={() => editor.chain().focus().deleteColumn().run()}>
        <Columns3 size="0.875rem" />
      </ToolButton>
      <ToolButton label="Delete table" onClick={() => editor.chain().focus().deleteTable().run()}>
        <Trash2 size="0.875rem" />
      </ToolButton>
    </BubbleMenu>
  );
}
