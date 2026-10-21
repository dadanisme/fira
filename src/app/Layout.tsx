import { Suspense, useRef, type CSSProperties } from 'react';
import { Outlet } from 'react-router';
import { ConfirmHost } from '../components/ConfirmDialog';
import { cx } from '../lib/cx';
import { Sidebar } from './Sidebar';
import { ExpandButton, PeekEdge } from './SidebarControls';
import { SidebarContext, useSidebarController } from './sidebarState';

/**
 * App shell: sidebar + main area. `--sidebar-w` (on the shell) is the sidebar width; `--shell-gutter`
 * (on main) is the room route headers leave at their left for the expand button while the sidebar is hidden.
 */
export function Layout() {
  const shellRef = useRef<HTMLDivElement>(null);
  const sidebar = useSidebarController(shellRef);
  return (
    <SidebarContext value={sidebar}>
      <div ref={shellRef} className="group/shell relative flex h-full" style={{ '--sidebar-w': `${sidebar.width}rem` } as CSSProperties}>
        {/* Takes the docked sidebar's space in the flex row; animates to 0 on collapse. */}
        {!sidebar.narrow && (
          <div
            aria-hidden
            className={cx(
              'shrink-0 transition-[width] duration-[120ms] ease-out motion-reduce:transition-none group-data-resizing/shell:transition-none',
              sidebar.docked ? 'w-[var(--sidebar-w)] group-data-snap/shell:w-0' : 'w-0',
            )}
          />
        )}
        {sidebar.drawerOpen && (
          <div
            aria-hidden
            className="fixed inset-0 z-40 bg-overlay transition-opacity starting:opacity-0 motion-reduce:transition-none"
            onClick={sidebar.collapse}
          />
        )}
        <Sidebar />
        {!sidebar.narrow && !sidebar.docked && <PeekEdge />}
        <main
          inert={sidebar.drawerOpen}
          className="relative flex min-w-0 flex-1 flex-col overflow-hidden"
          style={{ '--shell-gutter': sidebar.gutter } as CSSProperties}
        >
          <ExpandButton />
          <Suspense fallback={null}>
            <Outlet />
          </Suspense>
        </main>
        <ConfirmHost />
      </div>
    </SidebarContext>
  );
}
