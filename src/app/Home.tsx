import { Navigate, useNavigate } from 'react-router';
import { useProjects } from '../data/projects';
import { useWorkspace, useWsPath } from '../data/workspace';
import { NewProjectForm } from './NewProjectForm';

/** `/w/:slug`: opens the workspace's first project, or offers to create one. */
export function Home() {
  const { data: projects, loading } = useProjects();
  const navigate = useNavigate();
  const ws = useWsPath();
  const { name } = useWorkspace();

  if (loading) return null;
  if (projects.length > 0) return <Navigate to={ws(`/p/${projects[0].key}`)} replace />;
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-80 space-y-4">
        <div>
          <h1 className="text-lg font-semibold">Create the first project in {name}</h1>
          <p className="text-fg-muted">Projects hold a board of cards, keyed like NI-12.</p>
        </div>
        <NewProjectForm onCreated={(key) => navigate(ws(`/p/${key}`))} />
      </div>
    </div>
  );
}
