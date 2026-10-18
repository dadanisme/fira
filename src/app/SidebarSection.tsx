import type { ReactNode } from 'react';
import { NavLink } from 'react-router';
import { cx } from '../lib/cx';

/** Section heading with an optional action on the right. */
export function SidebarSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <div className="group flex h-7 items-center justify-between pr-1 pl-2 text-[11px] font-medium text-fg-faint">
        {title}
        {action}
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </section>
  );
}

/** A navigation row; active when the URL starts with `to`. */
export function SidebarLink({ to, icon, children, className }: { to: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cx(
          'flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-[13px]',
          isActive ? 'bg-active font-medium text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
          className,
        )
      }
    >
      {icon && <span className="flex w-4 shrink-0 justify-center">{icon}</span>}
      <span className="truncate">{children}</span>
    </NavLink>
  );
}
