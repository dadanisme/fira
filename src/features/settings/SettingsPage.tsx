import { useEffect, useRef, type ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useParams } from 'react-router';
import { Building2, KeyRound, Plus, Tag, Users } from 'lucide-react';
import { useProjects } from '../../data/projects';
import { useWsPath } from '../../data/workspace';
import { NewProjectForm } from '../../app/NewProjectForm';
import { cx } from '../../lib/cx';
import { Toasts } from '../board/toast';
import { LabelsSettings } from './LabelsSettings';
import { MembersSettings } from './MembersSettings';
import { ProjectSettings } from './ProjectSettings';
import { TokensSettings } from './TokensSettings';
import { WorkspaceSettings } from './WorkspaceSettings';
import { PageTitle } from './ui';

/** `/w/:slug/settings/*`: projects (name, work pages, columns, fields), workspace (general), labels, members, API tokens. */
export default function SettingsPage() {
  const { data: projects, loading } = useProjects();
  const ws = useWsPath();
  const strip = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  // Tab strip (below md): keep the active tab in view, centered when the strip scrolls.
  useEffect(() => {
    const el = strip.current;
    const active = el?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!el || !active || el.scrollWidth <= el.clientWidth) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' });
  }, [pathname, projects.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      {/* Below md: a horizontally scrolling tab strip right of the sidebar button; md+: a left column. */}
      <nav aria-label="Settings" className="flex shrink-0 border-b border-line pl-[calc(var(--shell-gutter,0rem)+0.5rem)] md:w-52 md:flex-col md:border-r md:border-b-0 md:pl-0">
        <div
          ref={strip}
          className={cx(
            'relative flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            'md:min-h-0 md:flex-col md:items-stretch md:gap-4 md:overflow-x-hidden md:overflow-y-auto md:py-3',
          )}
        >
          <div className="flex shrink-0 items-center gap-1 md:block">
            <div className="hidden h-7 items-center pr-2 pl-[calc(0.5rem+var(--shell-gutter,0rem))] text-xs font-medium text-fg-faint md:flex">Projects</div>
            {projects.map((p) => (
              <Item key={p.id} to={`projects/${p.key}`} icon={<span className="font-mono text-2xs font-semibold">{p.key.slice(0, 2)}</span>}>
                {p.name}
              </Item>
            ))}
            <Item to="projects/new" icon={<Plus size="0.875rem" />}>
              New project
            </Item>
          </div>
          <div className="flex shrink-0 items-center gap-1 border-l border-line pl-1 md:block md:border-l-0 md:pl-0">
            <div className="hidden h-7 items-center px-2 text-xs font-medium text-fg-faint md:flex">Workspace</div>
            <Item to="workspace" icon={<Building2 size="0.875rem" />}>
              General
            </Item>
            <Item to="labels" icon={<Tag size="0.875rem" />}>
              Labels
            </Item>
            <Item to="members" icon={<Users size="0.875rem" />}>
              Members
            </Item>
            <Item to="tokens" icon={<KeyRound size="0.875rem" />}>
              API tokens
            </Item>
          </div>
        </div>
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 py-5 md:px-6 md:py-6">
          <Routes>
            <Route
              index
              element={loading ? null : <Navigate to={projects[0] ? `projects/${projects[0].key}` : 'projects/new'} replace />}
            />
            <Route path="projects/new" element={<NewProject />} />
            <Route path="projects/:projectKey" element={<ProjectRoute />} />
            <Route path="workspace" element={<WorkspaceSettings />} />
            <Route path="labels" element={<LabelsSettings />} />
            <Route path="members" element={<MembersSettings />} />
            <Route path="tokens" element={<TokensSettings />} />
            <Route path="*" element={<Navigate to={ws('/settings')} replace />} />
          </Routes>
        </div>
      </div>
      <Toasts />
    </div>
  );
}

function Item({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  const ws = useWsPath();
  return (
    <NavLink
      to={ws(`/settings/${to}`)}
      end
      className={({ isActive }) =>
        cx(
          'flex h-9 shrink-0 items-center gap-2 rounded-md px-2.5 text-base whitespace-nowrap md:h-7 md:min-w-0 md:shrink md:px-2',
          isActive ? 'bg-active font-medium text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
        )
      }
    >
      <span className="flex w-4 shrink-0 justify-center text-fg-faint">{icon}</span>
      <span className="max-w-40 truncate md:max-w-none">{children}</span>
    </NavLink>
  );
}

function ProjectRoute() {
  const { projectKey } = useParams();
  const { data: projects, loading } = useProjects();
  const project = projects.find((p) => p.key === projectKey?.toUpperCase());
  if (loading) return null;
  if (!project) return <p className="text-fg-muted">No project with key “{projectKey}”.</p>;
  return <ProjectSettings key={project.id} project={project} />;
}

function NewProject() {
  const navigate = useNavigate();
  const ws = useWsPath();
  return (
    <div className="max-w-sm">
      <PageTitle title="New project" description="Projects hold a board of cards. The key prefixes every card (NI-12) and can't be changed later." />
      <NewProjectForm onCreated={(key) => navigate(ws(`/settings/projects/${key}`))} />
    </div>
  );
}
