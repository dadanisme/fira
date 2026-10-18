import { lazy, Suspense } from 'react';
import { useNavigate } from 'react-router';
import { LogOut, Plus, Settings } from 'lucide-react';
import { useProjects } from '../data/projects';
import { signOutUser, useUser } from '../lib/auth';
import { Avatar } from '../components/Avatar';
import { IconButton } from '../components/IconButton';
import { Menu, MenuItem } from '../components/Menu';
import { Popover } from '../components/Popover';
import { NewProjectForm } from './NewProjectForm';
import { SidebarLink, SidebarSection } from './SidebarSection';
import { ThemeToggle } from './ThemeToggle';

// Owned by the docs feature; renders its own section(s) (pages tree, templates).
const DocsTree = lazy(() => import('../features/docs/DocsTree'));

export function Sidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="flex h-11 items-center px-4 text-[15px] font-semibold tracking-tight">fira</div>
      <nav className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-2 pb-2">
        <ProjectsSection />
        <Suspense fallback={null}>
          <DocsTree />
        </Suspense>
      </nav>
      <div className="flex items-center gap-1 border-t border-line p-2">
        <SidebarLink to="/settings" icon={<Settings size={15} />} className="flex-1">
          Settings
        </SidebarLink>
        <ThemeToggle />
        <UserMenu />
      </div>
    </aside>
  );
}

function ProjectsSection() {
  const { data: projects } = useProjects();
  const navigate = useNavigate();

  return (
    <SidebarSection
      title="Projects"
      action={
        <Popover
          trigger={(props) => (
            <IconButton {...props} size="sm" label="New project">
              <Plus size={14} />
            </IconButton>
          )}
          className="w-72 p-3"
        >
          {({ close }) => (
            <NewProjectForm
              onCreated={(key) => {
                close();
                navigate(`/p/${key}`);
              }}
            />
          )}
        </Popover>
      }
    >
      {projects.map((p) => (
        <SidebarLink
          key={p.id}
          to={`/p/${p.key}`}
          icon={<span className="font-mono text-[10px] font-semibold text-fg-faint">{p.key.slice(0, 2)}</span>}
        >
          {p.name}
        </SidebarLink>
      ))}
    </SidebarSection>
  );
}

function UserMenu() {
  const user = useUser();
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
        <div className="px-2 py-1.5 text-xs text-fg-muted">{user.email}</div>
        <MenuItem icon={<LogOut size={14} />} onSelect={() => void signOutUser()}>
          Sign out
        </MenuItem>
      </Menu>
    </Popover>
  );
}
