import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  AlertTriangle,
  ChevronRight,
  Copy,
  FileText,
  History,
  LayoutTemplate,
  MessageSquare,
  MessageSquareCheck,
  MoreHorizontal,
  SmilePlus,
  SquareKanban,
  TableOfContents,
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
import { usePagePresence, type PagePresence } from '../../data/presence';
import { useWsPath } from '../../data/workspace';
import { useThreads } from '../../data/threads';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import {
  MarkdownEditor,
  MarkdownView,
  type CommentAnchor,
  type MarkdownEditorHandle,
  type OutlineHeading,
} from '../../components/MarkdownEditor';
import { Menu, MenuItem, MenuSeparator } from '../../components/Menu';
import { Popover } from '../../components/Popover';
import { useUser } from '../../lib/auth';
import { cx } from '../../lib/cx';
import { remPx } from '../../lib/rem';
import { duplicate, pageTitle } from './actions';
import { CommentsPanel, type PendingAnchor } from './CommentsPanel';
import { ConfirmButton } from './ConfirmButton';
import { HistoryDrawer } from './HistoryDrawer';
import { IconPicker } from './IconPicker';
import { Outline } from './Outline';
import { tocEntries, useActiveHeading } from './scrollspy';
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
        <FileText size="1.25rem" className="text-fg-faint" />
        Page not found
      </div>
    );
  }
  return <PageView key={page.id} page={page} pages={pages} />;
}

/**
 * Page widths (rem) at which columns fit beside the article. Measured on the page itself, so they
 * follow sidebar resize/collapse.
 * - WIDE_REM: the comments aside (the old 73.75rem viewport minus the default 15rem sidebar).
 * - TOC_REM / TOC_WITH_ASIDE_REM: the table of contents column (11rem + 2.5rem gap) while keeping
 *   the article at 34rem or more, without / with the comments aside (18rem + 2.5rem gap) and the 6rem padding.
 */
const WIDE_REM = 58.75;
const TOC_REM = 53.5;
const TOC_WITH_ASIDE_REM = 74;
const WIDTH_STEPS = [TOC_REM, WIDE_REM, TOC_WITH_ASIDE_REM];

/** The largest of WIDTH_STEPS the element's width reaches (0 below all), so resizing re-renders only at steps. */
function useWidthStep(ref: RefObject<HTMLElement | null>): number {
  const [step, setStep] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rem = el.getBoundingClientRect().width / remPx();
      setStep(WIDTH_STEPS.reduce((reached, s) => (rem >= s ? s : reached), 0));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return step;
}

function PageView({ page, pages }: { page: Page; pages: Page[] }) {
  const navigate = useNavigate();
  const ws = useWsPath();
  const save = useAutosave(page);
  const user = useUser();
  const me = useMemo(
    () => ({ uid: user.uid, name: user.displayName ?? user.email ?? 'Someone', photoURL: user.photoURL ?? undefined }),
    [user.uid, user.displayName, user.email, user.photoURL],
  );
  const present = usePagePresence(page.id, me, save.editing && !page.trashed);
  const editor = useRef<MarkdownEditorHandle>(null);
  const root = useRef<HTMLDivElement>(null);
  const widthStep = useWidthStep(root);
  const wide = widthStep >= WIDE_REM;

  // ------------------------------------------------ comments
  const { data: threads } = useThreads(page.id);
  const [showResolved, setShowResolved] = useState(false);
  const [positions, setPositions] = useState<Record<string, number>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ anchor: PendingAnchor; top: number } | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [asideHidden, setAsideHidden] = useState(false);
  const visibleThreads = useMemo(() => threads.filter((t) => showResolved || !t.resolved), [threads, showResolved]);
  const anchors = useMemo<CommentAnchor[]>(
    () => visibleThreads.map(({ id, quote, prefix, suffix }) => ({ id, quote, prefix, suffix })),
    [visibleThreads],
  );
  const openThreads = threads.filter((t) => !t.resolved).length;
  const resolvedThreads = threads.length - openThreads;

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
      setAsideHidden(false);
      if (!wide) setCommentsOpen(true);
    },
    [wide],
  );

  const activate = useCallback(
    (id: string | null) => {
      setActiveId(id);
      if (!id) return;
      setAsideHidden(false);
      if (!wide) setCommentsOpen(true);
      editor.current?.revealComment(id);
      document.querySelector(`[data-thread-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    [wide],
  );

  const panelProps = {
    pageId: page.id,
    threads,
    showResolved,
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
  const showAside = wide && !asideHidden && (visibleThreads.length > 0 || pending !== null || threads.length > 0);

  // Showing comments (column or resolved ones) with none in view scrolls to the nearest one below, else the closest above.
  const scroller = useRef<HTMLDivElement>(null);
  const [revealTick, setRevealTick] = useState(0);
  useEffect(() => {
    if (!revealTick) return;
    // Cards animate to their final `top`; measure once they've settled.
    const timer = setTimeout(() => {
      const sc = scroller.current;
      if (!sc) return;
      const view = sc.getBoundingClientRect();
      const rects = [...sc.querySelectorAll('aside [data-thread-card]')].map((c) => c.getBoundingClientRect());
      if (rects.length === 0 || rects.some((r) => r.bottom > view.top && r.top < view.bottom)) return;
      const below = rects.filter((r) => r.top >= view.bottom).sort((a, b) => a.top - b.top)[0];
      const target = below ?? rects.sort((a, b) => b.top - a.top)[0];
      sc.scrollBy({ top: target.top - view.top - 3 * remPx(), behavior: 'smooth' });
    }, 250);
    return () => clearTimeout(timer);
  }, [revealTick]);
  const reveal = () => setRevealTick((n) => n + 1);

  // ------------------------------------------------ table of contents
  const [outline, setOutline] = useState<OutlineHeading[]>([]);
  const toc = useMemo(() => (page.trashed ? [] : tocEntries(outline)), [outline, page.trashed]);
  const showToc = toc.length >= 2;
  const tocColumn = showToc && widthStep >= (showAside ? TOC_WITH_ASIDE_REM : TOC_REM);
  const activeHeading = useActiveHeading(scroller, editorBox, toc, 2.5);
  const goToHeading = (id: string) => {
    const el = editor.current?.revealHeading(id);
    const sc = scroller.current;
    if (!el || !sc) return;
    sc.scrollBy({ top: el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 1.5 * remPx(), behavior: 'smooth' });
  };

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
    <div ref={root} className="flex h-full min-h-0 flex-col">
      {/* Top bar */}
      <header className="flex h-11 shrink-0 items-center gap-2 pr-3 pl-[calc(0.75rem+var(--shell-gutter,0rem))]">
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 text-base text-fg-muted">
          {page.isTemplate && <LayoutTemplate size="0.8125rem" className="mr-1 shrink-0 text-fg-faint" />}
          {crumbs.map((c) => (
            <span key={c.id} className="flex min-w-0 items-center gap-0.5">
              <Link to={ws(`/d/${c.id}`)} className="max-w-40 truncate rounded px-1 py-0.5 hover:bg-hover hover:text-fg">
                {c.icon && <span className="mr-1">{c.icon}</span>}
                {pageTitle(c)}
              </Link>
              <ChevronRight size="0.75rem" className="shrink-0 text-fg-faint" />
            </span>
          ))}
          <span className="truncate px-1 text-fg">
            {page.icon && <span className="mr-1">{page.icon}</span>}
            {pageTitle({ title: save.title })}
          </span>
          {card && (
            <Link
              to={ws(`/p/${card.key.split('-')[0]}/${card.key}`)}
              title={card.title}
              className="ml-2 inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 text-xs font-medium"
              style={{ background: 'var(--label-blue-bg)', color: 'var(--label-blue-fg)' }}
            >
              <SquareKanban size="0.75rem" className="shrink-0" />
              <span className="font-mono">{card.key}</span>
            </Link>
          )}
        </nav>
        <Presence people={present} />
        <SaveStatus status={save.status} />
        {showToc && !tocColumn && (
          <Popover
            placement="bottom-end"
            trigger={(props) => (
              <IconButton {...props} label="Table of contents" active={props['aria-expanded']}>
                <TableOfContents size="0.9375rem" />
              </IconButton>
            )}
          >
            {({ close }) => (
              <nav aria-label="Table of contents" className="max-h-[60vh] w-64 overflow-y-auto p-3">
                <Outline
                  entries={toc}
                  activeId={activeHeading}
                  onSelect={(id) => {
                    close();
                    goToHeading(id);
                  }}
                />
              </nav>
            )}
          </Popover>
        )}
        <IconButton
          label={wide ? (asideHidden ? 'Show comments' : 'Hide comments') : 'Comments'}
          active={wide ? !asideHidden && showAside : commentsOpen}
          onClick={() => {
            if (!wide) return setCommentsOpen(!commentsOpen);
            setAsideHidden(!asideHidden);
            if (asideHidden) reveal();
          }}
        >
          <span className="relative">
            <MessageSquare size="0.9375rem" />
            {visibleThreads.length > 0 && (
              <span className="absolute -top-1.5 -right-2 rounded-full bg-accent px-1 text-2xs leading-3.5 font-semibold text-accent-fg">
                {visibleThreads.length}
              </span>
            )}
          </span>
        </IconButton>
        {resolvedThreads > 0 && (
          <IconButton
            label={showResolved ? 'Hide resolved comments' : `Show resolved comments (${resolvedThreads})`}
            active={showResolved}
            aria-pressed={showResolved}
            onClick={() => {
              setShowResolved(!showResolved);
              if (!showResolved) reveal();
            }}
          >
            <MessageSquareCheck size="0.9375rem" />
          </IconButton>
        )}
        <IconButton label="Version history" onClick={() => setHistoryOpen(true)}>
          <History size="0.9375rem" />
        </IconButton>
        <Popover
          placement="bottom-end"
          trigger={(props) => (
            <IconButton {...props} label="More">
              <MoreHorizontal size="0.9375rem" />
            </IconButton>
          )}
        >
          <Menu>
            <MenuItem icon={<Copy size="0.875rem" />} onSelect={() => navigate(ws(`/d/${duplicate(pages, page)}`))}>
              Duplicate
            </MenuItem>
            <MenuItem
              icon={page.isTemplate ? <FileText size="0.875rem" /> : <LayoutTemplate size="0.875rem" />}
              onSelect={() => updatePageMeta(page.id, { isTemplate: !page.isTemplate }).catch(reportError)}
            >
              {page.isTemplate ? 'Convert to page' : 'Convert to template'}
            </MenuItem>
            {!page.trashed && (
              <>
                <MenuSeparator />
                <MenuItem danger icon={<Trash2 size="0.875rem" />} onSelect={() => trashPage(page, pages).catch(reportError)}>
                  Move to trash
                </MenuItem>
              </>
            )}
          </Menu>
        </Popover>
      </header>

      {save.conflict && (
        <div className="mx-3 mb-1 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-sunken px-3 py-2 text-base">
          <AlertTriangle size="0.9375rem" className="shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            {save.conflict.updatedBy.type === 'user' && save.conflict.updatedBy.id === user.uid ? (
              <>You edited this page in another tab or device.</>
            ) : (
              <>
                <span className="font-medium">{save.conflict.updatedBy.name}</span> edited this page.
              </>
            )}{' '}
            <span className="text-fg-muted">Your changes aren't saved yet.</span>
          </span>
          <Button size="sm" onClick={save.loadTheirs}>
            Load their version
          </Button>
          <Button size="sm" variant="primary" onClick={save.keepMine} title="Save your version on top; theirs stays in version history">
            Keep mine
          </Button>
        </div>
      )}

      {page.trashed && (
        <div className="mx-3 mb-1 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--label-red-bg)] px-3 py-2 text-base text-[var(--label-red-fg)]">
          <Trash2 size="0.875rem" className="shrink-0" />
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
              navigate(ws('/trash'));
            }}
          >
            Delete forever
          </ConfirmButton>
        </div>
      )}

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex justify-center gap-10 px-6 sm:px-12">
          {tocColumn && (
            <nav
              aria-label="Table of contents"
              className="sticky top-6 max-h-[calc(100dvh-6rem)] w-44 shrink-0 self-start overflow-y-auto pb-8"
              style={{ marginTop: editorTop }}
            >
              <Outline entries={toc} activeId={activeHeading} onSelect={goToHeading} />
            </nav>
          )}
          <article className="w-full max-w-180 min-w-0 pt-12 pb-4">
            <div className="group/head">
              {page.icon ? (
                <IconPicker
                  value={page.icon}
                  onChange={setIcon}
                  trigger={(props) => (
                    <button {...props} type="button" className="mb-2 -ml-1 rounded-lg p-1 text-5xl leading-none hover:bg-hover">
                      {page.icon}
                    </button>
                  )}
                />
              ) : (
                <div className="mb-1 h-7 opacity-0 transition-opacity group-hover/head:opacity-100 focus-within:opacity-100">
                  <IconPicker
                    onChange={setIcon}
                    trigger={(props) => (
                      <Button {...props} variant="ghost" size="sm" icon={<SmilePlus size="0.875rem" />}>
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
                className="field-sizing-content w-full resize-none bg-transparent text-4xl leading-tight font-bold tracking-tight text-fg outline-none placeholder:text-fg-faint"
              />
            </div>

            {!page.isTemplate && !page.trashed && save.content.trim() === '' && templates.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm text-fg-faint">
                <span className="mr-1">Start from a template:</span>
                {templates.slice(0, 6).map((t) => (
                  <Button key={t.id} size="sm" icon={t.icon ? <span>{t.icon}</span> : <LayoutTemplate size="0.8125rem" />} onClick={() => applyTemplate(t)}>
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
                  foldStateKey={page.id}
                  onOutline={setOutline}
                />
              )}
            </div>
          </article>
          {showAside && (
            <aside className="w-72 shrink-0 pb-8" style={{ paddingTop: editorTop }}>
              <CommentsPanel {...panelProps} aligned />
            </aside>
          )}
        </div>
      </div>

      {!wide && commentsOpen && (
        <div className="absolute inset-y-0 right-0 z-30 flex w-80 max-w-full flex-col border-l border-line bg-bg shadow-popover">
          <div className="flex h-11 shrink-0 items-center justify-end px-2">
            <IconButton label="Close comments" onClick={() => setCommentsOpen(false)}>
              <ChevronRight size="0.9375rem" />
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
  const label = { saving: 'Saving…', saved: 'Saved', offline: 'Offline · kept on this device', error: "Couldn't save" }[status];
  return (
    <span
      className={cx('shrink-0 truncate px-1 text-sm', status === 'error' ? 'text-danger' : status === 'offline' ? 'text-warning' : 'text-fg-faint')}
      title={status === 'offline' ? 'Your edits are saved in this browser and will be saved to the page when you are back online.' : undefined}
    >
      {label}
    </span>
  );
}

const MAX_FACES = 4;

/** Avatars of the other people on this page; editors get an accent ring and dot. */
function Presence({ people }: { people: PagePresence[] }) {
  if (people.length === 0) return null;
  const shown = people.slice(0, MAX_FACES);
  const rest = people.slice(MAX_FACES);
  return (
    <div className="flex shrink-0 items-center -space-x-1 px-1">
      {shown.map((p) => {
        const label = `${p.name} is ${p.editing ? 'editing' : 'viewing'}`;
        return (
          <span key={p.uid} className="relative inline-flex rounded-full ring-2 ring-bg" title={label} aria-label={label}>
            <Avatar
              actor={{ type: 'user', id: p.uid, name: p.name }}
              photoURL={p.photoURL}
              title={label}
              size={22}
              className={cx(p.editing && 'ring-2 ring-accent')}
            />
            {p.editing && <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-accent ring-2 ring-bg" />}
          </span>
        );
      })}
      {rest.length > 0 && (
        <span
          className="relative inline-flex h-5.5 min-w-5.5 items-center justify-center rounded-full bg-sunken px-1 text-2xs font-semibold text-fg-muted ring-2 ring-bg"
          title={rest.map((p) => `${p.name} is ${p.editing ? 'editing' : 'viewing'}`).join('\n')}
        >
          +{rest.length}
        </span>
      )}
    </div>
  );
}
