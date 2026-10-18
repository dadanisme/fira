import { useParams } from 'react-router';
import { usePage } from '../../data/pages';

// Placeholder — owned by the docs feature.
export default function DocPage() {
  const { pageId } = useParams();
  const { data: page, loading } = usePage(pageId);
  if (loading) return null;
  return (
    <div className="p-6">
      <h1 className="text-base font-semibold">{page ? page.title || 'Untitled' : 'Page not found'}</h1>
    </div>
  );
}
