import { useMemo } from 'react';
import { Link } from 'react-router';
import { FileText, LayoutTemplate, RotateCcw, Trash2 } from 'lucide-react';
import { deletePageForever, restorePage, usePages } from '../../data/pages';
import { useWsPath } from '../../data/workspace';
import { Button } from '../../components/Button';
import { pageTitle } from './actions';
import { ConfirmButton } from './ConfirmButton';
import { timeAgo } from './format';

/** `/w/:slug/trash`: pages trashed together with their subtree are listed once, at the top-most trashed page. */
export default function TrashPage() {
  const { data: pages, loading } = usePages();
  const ws = useWsPath();
  const roots = useMemo(() => {
    const byId = new Map(pages.map((p) => [p.id, p]));
    return pages
      .filter((p) => p.trashed && !(p.parentId && byId.get(p.parentId)?.trashed && byId.get(p.parentId)?.trashedAt === p.trashedAt))
      .sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''));
  }, [pages]);
  const subpages = (id: string) => {
    const root = pages.find((p) => p.id === id);
    let n = 0;
    const visit = (pid: string) =>
      pages.forEach((p) => {
        if (p.parentId === pid && p.trashed && p.trashedAt === root?.trashedAt) {
          n++;
          visit(p.id);
        }
      });
    visit(id);
    return n;
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-180 px-6 pt-12 pb-8">
        <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Trash2 size="1.25rem" className="text-fg-faint" />
          Trash
        </h1>
        <p className="mb-6 text-fg-muted">Restoring a page also restores the subpages trashed with it.</p>
        {!loading && roots.length === 0 && <p className="py-8 text-center text-fg-faint">Trash is empty</p>}
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {roots.map((page) => {
            const n = subpages(page.id);
            return (
              <li key={page.id} className="flex min-h-11 items-center gap-3 py-1.5">
                <span className="flex w-5 justify-center text-fg-faint">
                  {page.icon ?? (page.isTemplate ? <LayoutTemplate size="0.9375rem" /> : <FileText size="0.9375rem" />)}
                </span>
                <div className="min-w-0 flex-1">
                  <Link to={ws(`/d/${page.id}`)} className="block truncate text-base font-medium hover:underline">
                    {pageTitle(page)}
                  </Link>
                  <div className="text-sm text-fg-faint">
                    {page.trashedAt && `Trashed ${timeAgo(page.trashedAt)}`}
                    {n > 0 && ` · ${n} subpage${n === 1 ? '' : 's'}`}
                  </div>
                </div>
                <Button size="sm" icon={<RotateCcw size="0.8125rem" />} onClick={() => restorePage(page, pages).catch(reportError)}>
                  Restore
                </Button>
                <ConfirmButton
                  size="sm"
                  variant="ghost"
                  question="Delete permanently?"
                  confirmLabel="Delete"
                  onConfirm={() => deletePageForever(page, pages).catch(reportError)}
                >
                  Delete forever
                </ConfirmButton>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
