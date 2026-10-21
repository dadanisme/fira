import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent as ReactMouseEvent } from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ChevronRight,
  Copy,
  FilePlus2,
  FileText,
  LayoutTemplate,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
import type { Page } from '@shared/types';
import { byRank } from '@shared/rank';
import { savePage, trashPage, updatePageMeta, usePages } from '../../data/pages';
import { useWsPath } from '../../data/workspace';
import { SidebarLink, SidebarSection } from '../../app/SidebarSection';
import { IconButton } from '../../components/IconButton';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../../components/Menu';
import { Popover } from '../../components/Popover';
import { preloadMarkdownEditor } from '../../components/MarkdownEditor';
import { cx } from '../../lib/cx';
import { remPx } from '../../lib/rem';
import { addPage, addPageFromTemplate, duplicate, pageTitle } from './actions';
import { ancestors, childrenMap, dropRank, flatten, project, type FlatItem, type Projection } from './tree';

// Rendered (lazily) in the sidebar below the projects. Keep Tiptap out of this module's imports.

/** Indent per tree level, in rem (0.75rem = 12 design px). */
const INDENT = 0.75;
const EXPANDED_KEY = 'fira-docs-expanded';

// ------------------------------------------------------------ expanded state (localStorage)

const expandedListeners = new Set<() => void>();
let expandedState: ReadonlySet<string> = readExpanded();

function readExpanded(): ReadonlySet<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

function setExpanded(id: string, open: boolean) {
  const next = new Set(expandedState);
  if (open) next.add(id);
  else next.delete(id);
  expandedState = next;
  try {
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
  } catch {
    // Storage unavailable: remembered for this session only.
  }
  expandedListeners.forEach((l) => l());
}

function useExpanded(): ReadonlySet<string> {
  return useSyncExternalStore(
    (l) => {
      expandedListeners.add(l);
      return () => expandedListeners.delete(l);
    },
    () => expandedState,
  );
}

// ------------------------------------------------------------ tree

export default function DocsTree() {
  const { data: pages } = usePages();
  const navigate = useNavigate();
  const ws = useWsPath();
  const templates = useMemo(() => pages.filter((p) => p.isTemplate && !p.trashed).sort(byRank), [pages]);
  const trashCount = useMemo(() => pages.filter((p) => p.trashed).length, [pages]);

  const create = (id: string) => navigate(ws(`/d/${id}`));

  return (
    <>
      <SidebarSection
        title="Docs"
        action={
          <Popover
            placement="bottom-end"
            trigger={(props) => (
              <IconButton {...props} size="sm" label="New page">
                <Plus size="0.875rem" />
              </IconButton>
            )}
          >
            <Menu>
              <MenuItem icon={<FilePlus2 size="0.875rem" />} onSelect={() => create(addPage(pages, null))}>
                New page
              </MenuItem>
              {templates.length > 0 && (
                <>
                  <MenuSeparator />
                  <MenuLabel>From template</MenuLabel>
                  {templates.map((t) => (
                    <MenuItem key={t.id} icon={t.icon ?? <LayoutTemplate size="0.875rem" />} onSelect={() => create(addPageFromTemplate(pages, t, null))}>
                      {pageTitle(t)}
                    </MenuItem>
                  ))}
                </>
              )}
            </Menu>
          </Popover>
        }
      >
        <PageTree pages={pages} templates={false} empty="No pages yet" />
      </SidebarSection>
      <SidebarSection
        title="Templates"
        action={
          <IconButton size="sm" label="New template" onClick={() => create(addPage(pages, null, true))}>
            <Plus size="0.875rem" />
          </IconButton>
        }
      >
        <PageTree pages={pages} templates empty="No templates" />
      </SidebarSection>
      <div className="-mt-2 flex flex-col">
        <SidebarLink to={ws('/trash')} icon={<Trash2 size="0.875rem" />}>
          Trash{trashCount > 0 && <span className="ml-1.5 text-fg-faint">{trashCount}</span>}
        </SidebarLink>
      </div>
    </>
  );
}

function PageTree({ pages, templates, empty }: { pages: Page[]; templates: boolean; empty: string }) {
  const stored = useExpanded();
  const activeMatch = useMatch('/w/:slug/d/:pageId');
  const activePageId = activeMatch?.params.pageId;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [offsetX, setOffsetX] = useState(0);

  const children = useMemo(() => childrenMap(pages, templates), [pages, templates]);
  // Reveal the active page once per navigation (not on every render), so its ancestors can still be collapsed.
  const revealed = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!activePageId || revealed.current === activePageId) return;
    const chain = ancestors(pages, activePageId);
    if (chain.length === 0 && !pages.some((p) => p.id === activePageId)) return; // pages not loaded yet
    revealed.current = activePageId;
    for (const a of chain) if (!expandedState.has(a.id)) setExpanded(a.id, true);
  }, [pages, activePageId]);
  const expanded = stored;
  const items = useMemo(() => flatten(children, expanded, dragId), [children, expanded, dragId]);
  const projection: Projection | null = dragId && overId ? project(items, dragId, overId, offsetX, INDENT * remPx()) : null;

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const reset = () => {
    setDragId(null);
    setOverId(null);
    setOffsetX(0);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    const target = over ? String(over.id) : null;
    const proj = target ? project(items, id, target, offsetX, INDENT * remPx()) : null;
    reset();
    if (!target || !proj) return;
    const page = pages.find((p) => p.id === id);
    if (!page) return;
    const currentParent = items.find((i) => i.id === id)?.parentId ?? null;
    if (target === id && proj.parentId === currentParent) return;
    const rank = dropRank(items, children, id, target, proj.parentId);
    if (proj.parentId) setExpanded(proj.parentId, true);
    updatePageMeta(id, { parentId: proj.parentId, rank }).catch(reportError);
  };

  if (items.length === 0 && !dragId) return <p className="px-2 py-1 text-sm text-fg-faint">{empty}</p>;

  const dragged = dragId ? items.find((i) => i.id === dragId) : undefined;
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={({ active }: DragStartEvent) => {
        setDragId(String(active.id));
        setOverId(String(active.id));
      }}
      onDragMove={({ delta }: DragMoveEvent) => setOffsetX(delta.x)}
      onDragOver={({ over }) => setOverId(over ? String(over.id) : null)}
      onDragEnd={onDragEnd}
      onDragCancel={reset}
    >
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        {items.map((item) => (
          <TreeRow
            key={item.id}
            item={item}
            pages={pages}
            depth={item.id === dragId && projection ? projection.depth : item.depth}
            expanded={expanded.has(item.id)}
            active={item.id === activePageId}
          />
        ))}
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {dragged && (
          <div className="flex h-7 items-center gap-2 rounded-md bg-surface px-2 text-base shadow-popover">
            <PageIcon page={dragged.page} />
            <span className="truncate">{pageTitle(dragged.page)}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

function PageIcon({ page }: { page: Page }) {
  if (page.icon) return <span className="text-base leading-none">{page.icon}</span>;
  return page.isTemplate ? <LayoutTemplate size="0.875rem" /> : <FileText size="0.875rem" />;
}

function TreeRow({ item, pages, depth, expanded, active }: { item: FlatItem; pages: Page[]; depth: number; expanded: boolean; active: boolean }) {
  const { page } = item;
  const navigate = useNavigate();
  const ws = useWsPath();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const onContextMenu = useCallback((e: ReactMouseEvent) => {
    e.preventDefault();
    setMenuOpen(true);
  }, []);

  const addChild = () => {
    setExpanded(page.id, true);
    navigate(ws(`/d/${addPage(pages, page.id, page.isTemplate)}`));
  };

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cx('group/row relative', isDragging && 'opacity-40')}
      onContextMenu={onContextMenu}
      onPointerEnter={preloadMarkdownEditor}
      {...attributes}
      {...listeners}
    >
      <div
        className={cx(
          'flex h-7 min-w-0 items-center gap-1 rounded-md pr-1 text-base',
          active ? 'bg-active font-medium text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
        )}
        style={{ paddingLeft: `${0.25 + depth * INDENT}rem` }}
      >
        <button
          type="button"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={() => setExpanded(page.id, !expanded)}
          onPointerDown={(e) => e.stopPropagation()}
          className={cx(
            'flex size-5 shrink-0 items-center justify-center rounded text-fg-faint hover:bg-active hover:text-fg',
            !item.hasChildren && 'invisible',
          )}
        >
          <ChevronRight size="0.8125rem" className={cx('transition-transform', expanded && 'rotate-90')} />
        </button>
        {item.hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            onClick={() => setExpanded(page.id, !expanded)}
            onPointerDown={(e) => e.stopPropagation()}
            className="flex w-4 shrink-0 justify-center"
          >
            <PageIcon page={page} />
          </button>
        ) : (
          <Link to={ws(`/d/${page.id}`)} draggable={false} tabIndex={-1} className="flex w-4 shrink-0 justify-center">
            <PageIcon page={page} />
          </Link>
        )}
        {renaming ? (
          <RenameInput page={page} onDone={() => setRenaming(false)} />
        ) : (
          <Link to={ws(`/d/${page.id}`)} draggable={false} className="min-w-0 flex-1 truncate py-1 pl-1">
            {pageTitle(page)}
          </Link>
        )}
        <div className={cx('flex items-center', !menuOpen && 'opacity-0 group-hover/row:opacity-100 focus-within:opacity-100')}>
          <Popover
            open={menuOpen}
            onOpenChange={setMenuOpen}
            trigger={(props) => (
              <IconButton {...props} size="sm" label="Page actions" onPointerDown={(e) => e.stopPropagation()}>
                <MoreHorizontal size="0.875rem" />
              </IconButton>
            )}
          >
            <Menu>
              <MenuItem icon={<Pencil size="0.875rem" />} onSelect={() => setRenaming(true)}>
                Rename
              </MenuItem>
              <MenuItem icon={<Plus size="0.875rem" />} onSelect={addChild}>
                Add subpage
              </MenuItem>
              {page.isTemplate && (
                <MenuItem icon={<FilePlus2 size="0.875rem" />} onSelect={() => navigate(ws(`/d/${addPageFromTemplate(pages, page, null)}`))}>
                  New page from template
                </MenuItem>
              )}
              <MenuItem icon={<Copy size="0.875rem" />} onSelect={() => navigate(ws(`/d/${duplicate(pages, page)}`))}>
                Duplicate
              </MenuItem>
              <MenuItem
                icon={page.isTemplate ? <FileText size="0.875rem" /> : <LayoutTemplate size="0.875rem" />}
                onSelect={() => updatePageMeta(page.id, { isTemplate: !page.isTemplate }).catch(reportError)}
              >
                {page.isTemplate ? 'Convert to page' : 'Convert to template'}
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                danger
                icon={<Trash2 size="0.875rem" />}
                onSelect={() => {
                  trashPage(page, pages).catch(reportError);
                  if (active) navigate(ws('/trash'));
                }}
              >
                Move to trash
              </MenuItem>
            </Menu>
          </Popover>
          <IconButton size="sm" label="Add subpage" onClick={addChild} onPointerDown={(e) => e.stopPropagation()}>
            <Plus size="0.875rem" />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

function RenameInput({ page, onDone }: { page: Page; onDone: () => void }) {
  const [title, setTitle] = useState(page.title);
  const commit = () => {
    if (title.trim() !== page.title) savePage(page, { title: title.trim() }).catch(reportError);
    onDone();
  };
  return (
    <input
      autoFocus
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={commit}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') onDone();
      }}
      placeholder="Untitled"
      className="h-6 min-w-0 flex-1 rounded border border-line bg-surface px-1.5 text-base text-fg outline-none focus:border-accent"
    />
  );
}
