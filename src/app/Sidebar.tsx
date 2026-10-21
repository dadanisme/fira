import { lazy, Suspense } from 'react';
import { useNavigate } from 'react-router';
import { LayoutGrid, LogOut, PanelLeftClose, PanelLeftOpen, Plus, Settings } from 'lucide-react';
import { useProjects } from '../data/projects';
import { useWsPath } from '../data/workspace';
import { signOutUser, useUser } from '../lib/auth';
import { Avatar } from '../components/Avatar';
import { IconButton } from '../components/IconButton';
import { Logo } from '../components/Logo';
import { Menu, MenuItem } from '../components/Menu';
import { Popover } from '../components/Popover';
import { cx } from '../lib/cx';
import { NewProjectForm } from './NewProjectForm';
import { SidebarLink, SidebarSection } from './SidebarSection';
import { ResizeHandle } from './SidebarControls';
import { useSidebar } from './sidebarState';
import { ThemeToggle } from './ThemeToggle';

// Owned by the docs feature; renders its own section(s) (pages tree, templates).
const DocsTree = lazy(() => import('../features/docs/DocsTree'));

/**
 * The app sidebar. Wide screens: docked (resizable, collapsible) or, when collapsed, a floating
 * overlay while hovered (peek). Narrow screens: an off-canvas drawer. State lives in the Layout.
 */
export function Sidebar() {
  const s = useSidebar();
  const ws = useWsPath();
  const visible = s.narrow ? s.drawerOpen : s.docked || s.peek;
  const pinnable = s.peek; // peeking: the header button keeps it open instead of collapsing

  return (
    <aside
      id="app-sidebar"
      aria-label="Sidebar"
      tabIndex={-1}
      inert={!visible}
      onPointerEnter={() => s.hover(true)}
      onPointerLeave={(e) => s.peek && s.hover(false, e.buttons)}
      onClickCapture={(e) => {
        // Drawer: following a link closes it (also when the link is the current page).
        if (s.narrow && e.target instanceof Element && e.target.closest('a[href]')) s.collapse();
      }}
      className={cx(
        'flex w-[var(--sidebar-w)] flex-col bg-sidebar outline-none',
        'transition-[width,translate] duration-[120ms] ease-out motion-reduce:transition-none group-data-resizing/shell:transition-none',
        s.narrow
          ? 'fixed inset-y-0 left-0 z-40 max-w-[85vw] border-r border-line'
          : s.floating
            ? 'fixed top-11 bottom-2 left-0 z-40 overflow-hidden rounded-r-lg border border-l-0 border-line'
            : 'absolute inset-y-0 left-0 z-10 border-r border-line',
        // No translate at all while shown: a transform would re-anchor the docs tree's fixed DragOverlay.
        !visible && '-translate-x-full',
        visible && (s.narrow || s.floating) && 'shadow-popover',
        s.docked && 'group-data-snap/shell:-translate-x-full',
      )}
    >
      <div className="group/header flex h-11 shrink-0 items-center gap-2 pr-2 pl-4 text-md font-semibold tracking-tight">
        <Logo size={16} />
        <span className="flex-1">fira</span>
        <IconButton
          id="sidebar-toggle"
          label={pinnable ? 'Keep sidebar open' : 'Close sidebar'}
          aria-expanded={!pinnable}
          aria-controls="app-sidebar"
          onClick={pinnable ? s.expand : s.collapse}
          className={cx(!s.narrow && !pinnable && 'opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100')}
        >
          {pinnable ? <PanelLeftOpen size="0.9375rem" /> : <PanelLeftClose size="0.9375rem" />}
        </IconButton>
      </div>
      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-2">
        <ProjectsSection />
        <Suspense fallback={null}>
          <DocsTree />
        </Suspense>
      </nav>
      <div className="flex items-center gap-1 border-t border-line p-2">
        <SidebarLink to={ws('/settings')} icon={<Settings size="0.9375rem" />} className="flex-1">
          Settings
        </SidebarLink>
        <ThemeToggle />
        <UserMenu />
      </div>
      {s.docked && <ResizeHandle />}
    </aside>
  );
}

function ProjectsSection() {
  const { data: projects } = useProjects();
  const navigate = useNavigate();
  const ws = useWsPath();

  return (
    <SidebarSection
      title="Projects"
      action={
        <Popover
          trigger={(props) => (
            <IconButton {...props} size="sm" label="New project">
              <Plus size="0.875rem" />
            </IconButton>
          )}
          className="w-72 p-3"
        >
          {({ close }) => (
            <NewProjectForm
              onCreated={(key) => {
                close();
                navigate(ws(`/p/${key}`));
              }}
            />
          )}
        </Popover>
      }
    >
      {projects.map((p) => (
        <SidebarLink
          key={p.id}
          to={ws(`/p/${p.key}`)}
          icon={<span className="font-mono text-2xs font-semibold text-fg-faint">{p.key.slice(0, 2)}</span>}
        >
          {p.name}
        </SidebarLink>
      ))}
    </SidebarSection>
  );
}

function UserMenu() {
  const user = useUser();
  const navigate = useNavigate();
  return (
    <Popover
      placement="bottom-end"
      trigger={(props) => (
        <button {...props} type="button" aria-label="Account" className="flex size-7 items-center justify-center rounded-md hover:bg-hover">
          <Avatar actor={{ type: 'user', id: user.uid, name: user.displayName ?? user.email ?? '?' }} />
        </button>
      )}
    >
      <Menu>
        <div className="px-2 py-1.5 text-sm text-fg-muted">{user.email}</div>
        {/* Placeholder until the workspace switcher (T3). */}
        <MenuItem icon={<LayoutGrid size="0.875rem" />} onSelect={() => navigate('/workspaces')}>
          All workspaces
        </MenuItem>
        <MenuItem icon={<LogOut size="0.875rem" />} onSelect={() => void signOutUser()}>
          Sign out
        </MenuItem>
      </Menu>
    </Popover>
  );
}
