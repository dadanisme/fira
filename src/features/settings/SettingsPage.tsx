import type { ReactNode } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate, useParams } from 'react-router';
import { KeyRound, Plus, Tag } from 'lucide-react';
import { useProjects } from '../../data/projects';
import { NewProjectForm } from '../../app/NewProjectForm';
import { cx } from '../../lib/cx';
import { Toasts } from '../board/toast';
import { LabelsSettings } from './LabelsSettings';
import { ProjectSettings } from './ProjectSettings';
import { TokensSettings } from './TokensSettings';
import { PageTitle } from './ui';

/** `/settings/*`: projects (name, work pages, columns, fields), labels, API tokens. */
export default function SettingsPage() {
  const { data: projects, loading } = useProjects();
  return (
    <div className="flex min-h-0 flex-1">
      <nav aria-label="Settings" className="flex w-52 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line px-2 py-3">
        <div>
          <div className="flex h-7 items-center px-2 text-xs font-medium text-fg-faint">Projects</div>
          {projects.map((p) => (
            <Item key={p.id} to={`projects/${p.key}`} icon={<span className="font-mono text-2xs font-semibold">{p.key.slice(0, 2)}</span>}>
              {p.name}
            </Item>
          ))}
          <Item to="projects/new" icon={<Plus size="0.875rem" />}>
            New project
          </Item>
        </div>
        <div>
          <div className="flex h-7 items-center px-2 text-xs font-medium text-fg-faint">Workspace</div>
          <Item to="labels" icon={<Tag size="0.875rem" />}>
            Labels
          </Item>
          <Item to="tokens" icon={<KeyRound size="0.875rem" />}>
            API tokens
          </Item>
        </div>
      </nav>
      <div className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-6">
          <Routes>
            <Route
              index
              element={loading ? null : <Navigate to={projects[0] ? `projects/${projects[0].key}` : 'projects/new'} replace />}
            />
            <Route path="projects/new" element={<NewProject />} />
            <Route path="projects/:projectKey" element={<ProjectRoute />} />
            <Route path="labels" element={<LabelsSettings />} />
            <Route path="tokens" element={<TokensSettings />} />
            <Route path="*" element={<Navigate to="/settings" replace />} />
          </Routes>
        </div>
      </div>
      <Toasts />
    </div>
  );
}

function Item({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <NavLink
      to={`/settings/${to}`}
      end
      className={({ isActive }) =>
        cx(
          'flex h-7 min-w-0 items-center gap-2 rounded-md px-2 text-base',
          isActive ? 'bg-active font-medium text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
        )
      }
    >
      <span className="flex w-4 shrink-0 justify-center text-fg-faint">{icon}</span>
      <span className="truncate">{children}</span>
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
  return (
    <div className="max-w-sm">
      <PageTitle title="New project" description="Projects hold a board of cards. The key prefixes every card (NI-12) and can't be changed later." />
      <NewProjectForm onCreated={(key) => navigate(`/settings/projects/${key}`)} />
    </div>
  );
}
