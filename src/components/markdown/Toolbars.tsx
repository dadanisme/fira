import { useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { isTextSelection } from '@tiptap/core';
import {
  Bold,
  Code,
  Italic,
  Link2,
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

function ToolButton({ label, active, onClick, children }: { label: string; active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cx(
        'inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-1.5 text-sm text-fg-muted hover:bg-hover hover:text-fg',
        active && 'bg-active text-fg',
      )}
    >
      {children}
    </button>
  );
}

const Divider = () => <span className="mx-0.5 h-4 w-px bg-line" />;

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

  const applyLink = () => {
    const url = href.trim();
    const chain = editor.chain().focus().extendMarkRange('link');
    if (url) chain.setLink({ href: /^[a-z][\w+.-]*:|^\/|^#/i.test(url) ? url : `https://${url}` }).run();
    else chain.unsetLink().run();
    setLinking(false);
  };

  return (
    <BubbleMenu
      editor={editor}
      pluginKey="formatBubble"
      options={{ placement: 'top', offset: 6 }}
      shouldShow={({ editor: e, state: s, from, to, view, element }) => {
        if (!view.hasFocus() && !element.contains(document.activeElement)) return false;
        if (!isTextSelection(s.selection) || from === to || e.isActive('codeBlock')) return false;
        return s.doc.textBetween(from, to).trim().length > 0;
      }}
      className="z-40 flex items-center gap-0.5 rounded-lg bg-surface p-0.5 shadow-popover"
    >
      {linking ? (
        <form
          className="flex items-center gap-1 p-0.5"
          onSubmit={(e) => {
            e.preventDefault();
            applyLink();
          }}
        >
          <input
            autoFocus
            value={href}
            onChange={(e) => setHref(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                setLinking(false);
                editor.commands.focus();
              }
            }}
            placeholder="Paste a link…"
            className="h-6 w-56 rounded bg-transparent px-1.5 text-sm text-fg outline-none placeholder:text-fg-faint"
          />
          {state.link && (
            <ToolButton label="Remove link" onClick={() => (setHref(''), editor.chain().focus().extendMarkRange('link').unsetLink().run(), setLinking(false))}>
              <Unlink size="0.875rem" />
            </ToolButton>
          )}
        </form>
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
