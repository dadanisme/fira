import { useCallback, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  FileText,
  History,
  LayoutTemplate,
  MessageSquare,
  MoreHorizontal,
  SmilePlus,
  SquareKanban,
  Trash2,
} from 'lucide-react';
import type { Page } from '@shared/types';
import { byRank } from '@shared/rank';
import {
  deletePageForever,
  restorePage,
  trashPage,
  updatePageMeta,
  uploadPageImage,
  useLinkedCard,
  usePage,
  usePages,
} from '../../data/pages';
import { useThreads } from '../../data/threads';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { MarkdownEditor, MarkdownView, type CommentAnchor, type MarkdownEditorHandle } from '../../components/MarkdownEditor';
import { Menu, MenuItem, MenuSeparator } from '../../components/Menu';
import { Popover } from '../../components/Popover';
import { cx } from '../../lib/cx';
import { duplicate, pageTitle } from './actions';
import { CommentsPanel, type PendingAnchor } from './CommentsPanel';
import { ConfirmButton } from './ConfirmButton';
import { HistoryDrawer } from './HistoryDrawer';
import { IconPicker } from './IconPicker';
import { ancestors } from './tree';
import { useAutosave } from './useAutosave';

export default function DocPage() {
  const { pageId } = useParams();
  const { data: live, loading } = usePage(pageId);
  const { data: pages } = usePages();
  // While the page's own listener attaches, render from the (already loaded) tree listener.
  const page = live ?? (loading ? (pages.find((p) => p.id === pageId) ?? null) : null);
  if (!page) {
    if (loading) return null;
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-fg-muted">
        <FileText size={20} className="text-fg-faint" />
        Page not found
      </div>
    );
  }
  return <PageView key={page.id} page={page} pages={pages} />;
}

const WIDE = '(min-width: 1180px)';
function useWide(): boolean {
  return useSyncExternalStore(
    (l) => {
      const m = matchMedia(WIDE);
      m.addEventListener('change', l);
      return () => m.removeEventListener('change', l);
    },
    () => matchMedia(WIDE).matches,
  );
}

function PageView({ page, pages }: { page: Page; pages: Page[] }) {
  const navigate = useNavigate();
  const save = useAutosave(page);
  const editor = useRef<MarkdownEditorHandle>(null);
  const wide = useWide();

  // ------------------------------------------------ comments
  const { data: threads } = useThreads(page.id);
  const [showResolved, setShowResolved] = useState(false);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ anchor: PendingAnchor; top: number } | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const visibleThreads = useMemo(() => threads.filter((t) => showResolved || !t.resolved), [threads, showResolved]);
  const anchors = useMemo<CommentAnchor[]>(
    () => visibleThreads.map(({ id, quote, prefix, suffix }) => ({ id, quote, prefix, suffix })),
    [visibleThreads],
  );
  const openThreads = threads.filter((t) => !t.resolved).length;

  const editorBox = useRef<HTMLDivElement>(null);
  const [editorTop, setEditorTop] = useState(0);
  useLayoutEffect(() => {
    const el = editorBox.current;
    if (!el) return;
    const measure = () => setEditorTop(el.offsetTop);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el.parentElement ?? el);
    return () => ro.disconnect();
  }, []);

  const onComment = useCallback(
    (anchor: PendingAnchor) => {
      const rect = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0).getBoundingClientRect() : null;
      const base = editorBox.current?.getBoundingClientRect().top ?? 0;
      setPending({ anchor, top: rect ? Math.max(0, rect.top - base) : 0 });
      setActiveId(null);
      if (!wide) setCommentsOpen(true);
    },
    [wide],
  );

  const activate = useCallback(
    (id: string | null) => {
      setActiveId(id);
      if (!id) return;
      if (!wide) setCommentsOpen(true);
      document.querySelector(`[data-thread-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    [wide],
  );

  const panelProps = {
    pageId: page.id,
    threads,
    showResolved,
    onShowResolved: setShowResolved,
    positions,
    activeId,
    onActivate: activate,
    pending: pending?.anchor ?? null,
    pendingTop: pending?.top ?? 0,
    onPendingDone: (id: string | null) => {
      setPending(null);
      if (id) setActiveId(id);
    },
  };
  const showAside = wide && (visibleThreads.length > 0 || pending !== null || threads.length > 0);

  // ------------------------------------------------ misc
  const [historyOpen, setHistoryOpen] = useState(false);
  const { data: card } = useLinkedCard(page.cardId);
  const crumbs = useMemo(() => ancestors(pages, page.id).reverse(), [pages, page.id]);
  const templates = useMemo(() => pages.filter((p) => p.isTemplate && !p.trashed && p.id !== page.id).sort(byRank), [pages, page.id]);
  const uploadImage = useCallback((file: File) => uploadPageImage(page.id, file), [page.id]);
  const setIcon = (icon: string | null) => updatePageMeta(page.id, { icon }).catch(reportError);

  const applyTemplate = (t: Page) => {
    save.replaceContent(t.content);
    if (!save.title.trim()) save.setTitle(t.title);
    if (!page.icon && t.icon) setIcon(t.icon);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Top bar */}
      <header className="flex h-11 shrink-0 items-center gap-2 px-3">
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 text-[13px] text-fg-muted">
          {page.isTemplate && <LayoutTemplate size={13} className="mr-1 shrink-0 text-fg-faint" />}
          {crumbs.map((c) => (
            <span key={c.id} className="flex min-w-0 items-center gap-0.5">
              <Link to={`/d/${c.id}`} className="max-w-40 truncate rounded px-1 py-0.5 hover:bg-hover hover:text-fg">
                {c.icon && <span className="mr-1">{c.icon}</span>}
                {pageTitle(c)}
              </Link>
              <ChevronRight size={12} className="shrink-0 text-fg-faint" />
            </span>
          ))}
          <span className="truncate px-1 text-fg">
            {page.icon && <span className="mr-1">{page.icon}</span>}
            {pageTitle({ title: save.title })}
          </span>
          {card && (
            <Link
              to={`/p/${card.key.split('-')[0]}/${card.key}`}
              title={card.title}
              className="ml-2 inline-flex h-5 max-w-56 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] font-medium"
              style={{ background: 'var(--label-blue-bg)', color: 'var(--label-blue-fg)' }}
            >
              <SquareKanban size={12} />
              <span className="font-mono">{card.key}</span>
              <span className="truncate font-normal">{card.title}</span>
            </Link>
          )}
        </nav>
        <SaveStatus status={save.status} />
        {!wide && (
          <IconButton label="Comments" active={commentsOpen} onClick={() => setCommentsOpen(!commentsOpen)}>
            <span className="relative">
              <MessageSquare size={15} />
              {openThreads > 0 && (
                <span className="absolute -top-1.5 -right-2 rounded-full bg-accent px-1 text-[9px] leading-[13px] font-semibold text-accent-fg">{openThreads}</span>
              )}
            </span>
          </IconButton>
        )}
        <IconButton label="Version history" onClick={() => setHistoryOpen(true)}>
          <History size={15} />
        </IconButton>
        <Popover
          placement="bottom-end"
          trigger={(props) => (
            <IconButton {...props} label="More">
              <MoreHorizontal size={15} />
            </IconButton>
          )}
        >
          <Menu>
            <MenuItem icon={<Copy size={14} />} onSelect={() => navigate(`/d/${duplicate(pages, page)}`)}>
              Duplicate
            </MenuItem>
            <MenuItem
              icon={page.isTemplate ? <FileText size={14} /> : <LayoutTemplate size={14} />}
              onSelect={() => updatePageMeta(page.id, { isTemplate: !page.isTemplate }).catch(reportError)}
            >
              {page.isTemplate ? 'Convert to page' : 'Convert to template'}
            </MenuItem>
            {!page.trashed && (
              <>
                <MenuSeparator />
                <MenuItem danger icon={<Trash2 size={14} />} onSelect={() => trashPage(page, pages).catch(reportError)}>
                  Move to trash
                </MenuItem>
              </>
            )}
          </Menu>
        </Popover>
      </header>

      {save.conflict && (
        <div className="mx-3 mb-1 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-sunken px-3 py-2 text-[13px]">
          <AlertTriangle size={15} className="shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            <span className="font-medium">{save.conflict.updatedBy.name}</span> changed this page while you were editing. Your edits are not saved yet.
          </span>
          <Button size="sm" onClick={save.reloadTheirs}>
            Reload theirs
          </Button>
          <Button size="sm" variant="primary" onClick={save.keepMine}>
            Keep mine (overwrite)
          </Button>
        </div>
      )}

      {page.trashed && (
        <div className="mx-3 mb-1 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--label-red-bg)] px-3 py-2 text-[13px] text-[var(--label-red-fg)]">
          <Trash2 size={14} className="shrink-0" />
          <span className="flex-1">This page is in the trash.</span>
          <Button size="sm" onClick={() => restorePage(page, pages).catch(reportError)}>
            Restore
          </Button>
          <ConfirmButton
            size="sm"
            variant="ghost"
            question="Delete permanently?"
            confirmLabel="Delete"
            onConfirm={() => {
              deletePageForever(page, pages).catch(reportError);
              navigate('/trash');
            }}
          >
            Delete forever
          </ConfirmButton>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex justify-center gap-10 px-6 sm:px-12">
          <article className="w-full max-w-[720px] min-w-0 pt-12 pb-4">
            <div className="group/head">
              {page.icon ? (
                <IconPicker
                  value={page.icon}
                  onChange={setIcon}
                  trigger={(props) => (
                    <button {...props} type="button" className="mb-2 -ml-1 rounded-lg p-1 text-[44px] leading-none hover:bg-hover">
                      {page.icon}
                    </button>
                  )}
                />
              ) : (
                <div className="mb-1 h-7 opacity-0 transition-opacity group-hover/head:opacity-100 focus-within:opacity-100">
                  <IconPicker
                    onChange={setIcon}
                    trigger={(props) => (
                      <Button {...props} variant="ghost" size="sm" icon={<SmilePlus size={14} />}>
                        Add icon
                      </Button>
                    )}
                  />
                </div>
              )}
              <textarea
                value={save.title}
                rows={1}
                readOnly={page.trashed}
                onChange={(e) => save.setTitle(e.target.value.replace(/\n/g, ''))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || (e.key === 'ArrowDown' && e.currentTarget.selectionStart === e.currentTarget.value.length)) {
                    e.preventDefault();
                    editor.current?.focus();
                  }
                }}
                placeholder="Untitled"
                aria-label="Title"
                className="field-sizing-content w-full resize-none bg-transparent text-[32px] leading-tight font-bold tracking-tight text-fg outline-none placeholder:text-fg-faint"
              />
            </div>

            {!page.isTemplate && !page.trashed && save.content.trim() === '' && templates.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-fg-faint">
                <span className="mr-1">Start from a template:</span>
                {templates.slice(0, 6).map((t) => (
                  <Button key={t.id} size="sm" icon={t.icon ? <span>{t.icon}</span> : <LayoutTemplate size={13} />} onClick={() => applyTemplate(t)}>
                    {pageTitle(t)}
                  </Button>
                ))}
              </div>
            )}

            <div ref={editorBox} className="mt-4">
              {page.trashed ? (
                <MarkdownView value={page.content} variant="page" />
              ) : (
                <MarkdownEditor
                  ref={editor}
                  variant="page"
                  value={save.content}
                  onChange={save.setContent}
                  uploadImage={uploadImage}
                  comments={anchors}
                  activeCommentId={activeId}
                  onCommentClick={activate}
                  onCommentPositions={setPositions}
                  onComment={onComment}
                />
              )}
            </div>
          </article>
          {showAside && (
            <aside className="w-72 shrink-0 pb-8" style={{ paddingTop: Math.max(0, editorTop - 32) }}>
              <CommentsPanel {...panelProps} aligned />
            </aside>
          )}
        </div>
      </div>

      {!wide && commentsOpen && (
        <div className="absolute inset-y-0 right-0 z-30 flex w-80 max-w-full flex-col border-l border-line bg-bg shadow-popover">
          <div className="flex h-11 shrink-0 items-center justify-end px-2">
            <IconButton label="Close comments" onClick={() => setCommentsOpen(false)}>
              <ChevronRight size={15} />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
            <CommentsPanel {...panelProps} aligned={false} />
          </div>
        </div>
      )}

      {historyOpen && <HistoryDrawer page={page} onClose={() => setHistoryOpen(false)} onBeforeRestore={save.discard} />}
    </div>
  );
}

function SaveStatus({ status }: { status: ReturnType<typeof useAutosave>['status'] }) {
  if (status === 'idle') return null;
  return (
    <span className={cx('shrink-0 px-1 text-xs', status === 'error' ? 'text-danger' : 'text-fg-faint')}>
      {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : "Couldn't save"}
    </span>
  );
}
