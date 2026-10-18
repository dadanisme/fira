import { useParams } from 'react-router';
import { useProject } from '../../data/projects';

// Placeholder — owned by the board feature.
export default function BoardPage() {
  const { projectKey, cardKey } = useParams();
  const { data: project, loading } = useProject(projectKey);
  if (loading) return null;
  return (
    <div className="p-6">
      <h1 className="text-base font-semibold">{project?.name ?? 'Project not found'}</h1>
      {cardKey && <p className="text-fg-muted">Card {cardKey}</p>}
    </div>
  );
}
