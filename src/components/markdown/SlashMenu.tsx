import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Editor } from '@tiptap/core';
import {
  Code2,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Table,
} from 'lucide-react';
import { cx } from '../../lib/cx';
import { slashKey, type SlashState } from './slashCommand';

interface Item {
  title: string;
  keywords: string;
  icon: ReactNode;
  run: (editor: Editor) => void;
}

const ITEMS: Item[] = [
  { title: 'Text', keywords: 'paragraph plain', icon: <Pilcrow size={15} />, run: (e) => e.chain().focus().setParagraph().run() },
  { title: 'Heading 1', keywords: 'h1 title', icon: <Heading1 size={15} />, run: (e) => e.chain().focus().setHeading({ level: 1 }).run() },
  { title: 'Heading 2', keywords: 'h2 subtitle', icon: <Heading2 size={15} />, run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { title: 'Heading 3', keywords: 'h3', icon: <Heading3 size={15} />, run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { title: 'Bulleted list', keywords: 'ul unordered bullet', icon: <List size={15} />, run: (e) => e.chain().focus().toggleBulletList().run() },
  { title: 'Numbered list', keywords: 'ol ordered number', icon: <ListOrdered size={15} />, run: (e) => e.chain().focus().toggleOrderedList().run() },
  { title: 'Task list', keywords: 'todo checkbox check', icon: <ListChecks size={15} />, run: (e) => e.chain().focus().toggleTaskList().run() },
  { title: 'Quote', keywords: 'blockquote', icon: <Quote size={15} />, run: (e) => e.chain().focus().toggleBlockquote().run() },
  { title: 'Code block', keywords: 'pre snippet', icon: <Code2 size={15} />, run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { title: 'Divider', keywords: 'hr rule separator line', icon: <Minus size={15} />, run: (e) => e.chain().focus().setHorizontalRule().run() },
  {
    title: 'Table',
    keywords: 'grid',
    icon: <Table size={15} />,
    run: (e) => e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
];

const IMAGE_ITEM_TITLE = 'Image';

export interface SlashMenuProps {
  editor: Editor;
  /** Set by the menu while open; the slash plugin forwards key presses to it. */
  keyHandler: RefObject<((e: KeyboardEvent) => boolean) | null>;
  /** Opens a file picker and inserts the uploaded image; absent = no image item. */
  pickImage?: () => void;
}

/** The `/` command menu (page variant). */
export function SlashMenu({ editor, keyHandler, pickImage }: SlashMenuProps) {
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [index, setIndex] = useState(0);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const s = slashKey.getState(editor.state);
      setSlash((prev) => (s?.active ? (prev?.from === s.from && prev.query === s.query ? prev : s) : null));
    };
    editor.on('transaction', update);
    return () => {
      editor.off('transaction', update);
    };
  }, [editor]);

  const items = useMemo(() => {
    const all = pickImage
      ? [...ITEMS, { title: IMAGE_ITEM_TITLE, keywords: 'picture photo upload', icon: <ImageIcon size={15} />, run: pickImage }]
      : ITEMS;
    const q = slash?.query.toLowerCase() ?? '';
    return q ? all.filter((i) => i.title.toLowerCase().includes(q) || i.keywords.includes(q)) : all;
  }, [slash?.query, pickImage]);

  const [prevQuery, setPrevQuery] = useState(slash?.query);
  if (prevQuery !== slash?.query) {
    setPrevQuery(slash?.query);
    setIndex(0);
  }

  const choose = (item: Item) => {
    if (!slash) return;
    editor.chain().focus().deleteRange({ from: slash.from, to: editor.state.selection.from }).run();
    item.run(editor);
  };

  useEffect(() => {
    if (!slash) {
      keyHandler.current = null;
      return;
    }
    keyHandler.current = (e) => {
      if (items.length === 0) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setIndex((i) => (i + step + items.length) % items.length);
        return true;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        choose(items[Math.min(index, items.length - 1)]);
        return true;
      }
      return false;
    };
  });

  useLayoutEffect(() => {
    if (!slash || !panel.current) {
      setPos(null);
      return;
    }
    try {
      const c = editor.view.coordsAtPos(slash.from);
      const h = panel.current.offsetHeight;
      const below = c.bottom + 4 + h <= innerHeight - 8;
      setPos({ top: below ? c.bottom + 4 : Math.max(8, c.top - 4 - h), left: Math.min(c.left, innerWidth - 248) });
    } catch {
      setPos(null);
    }
  }, [editor, slash, items.length]);

  useEffect(() => {
    panel.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!slash || items.length === 0) return null;
  return createPortal(
    <div
      ref={panel}
      role="listbox"
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-50 flex max-h-72 w-60 flex-col overflow-y-auto rounded-lg bg-surface p-1 text-fg shadow-popover"
      style={pos ?? { top: 0, left: 0, opacity: 0 }}
    >
      <div className="px-2 pt-1 pb-1 text-[11px] font-medium text-fg-faint">Blocks</div>
      {items.map((item, i) => (
        <button
          key={item.title}
          type="button"
          role="option"
          aria-selected={i === index}
          data-selected={i === index}
          onMouseEnter={() => setIndex(i)}
          onClick={() => choose(item)}
          className={cx('flex h-8 shrink-0 items-center gap-2.5 rounded-md px-2 text-left text-[13px]', i === index && 'bg-hover')}
        >
          <span className="flex size-6 items-center justify-center rounded border border-line bg-surface text-fg-muted">{item.icon}</span>
          {item.title}
        </button>
      ))}
    </div>,
    document.body,
  );
}
