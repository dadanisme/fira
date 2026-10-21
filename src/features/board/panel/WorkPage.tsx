import { Link } from 'react-router';
import { ArrowUpRight, FilePlus, FileText, Unlink } from 'lucide-react';
import type { Card } from '@shared/types';
import { rankAfterLast } from '@shared/rank';
import { createPage, createPageFromTemplate, usePages } from '../../../data/pages';
import { useWsPath } from '../../../data/workspace';
import { Button } from '../../../components/Button';
import { IconButton } from '../../../components/IconButton';
import { patchCard, run, useBoardData } from '../context';
import { Section } from './Section';

/** The card's linked work page: create one from the project's template, open or unlink it. */
export function WorkPage({ card }: { card: Card }) {
  const data = useBoardData();
  const { project } = data;
  const { data: pages, loading } = usePages();
  const ws = useWsPath();
  const page = card.pageId ? pages.find((p) => p.id === card.pageId) : undefined;

  const create = () =>
    run(() => {
      const live = (id: string | undefined) => (id ? pages.find((p) => p.id === id && !p.trashed) : undefined);
      const template = live(project.pageTemplateId);
      const parentId = live(project.pageParentId)?.id ?? null;
      const siblings = pages.filter((p) => p.parentId === parentId && !p.trashed && !p.isTemplate);
      const input = { rank: rankAfterLast(siblings), parentId, cardId: card.id, title: `${card.key} ${card.title}`.trim() };
      const id = template ? createPageFromTemplate(template, input) : createPage(input);
      patchCard(data, card, { pageId: id });
    });

  return (
    <Section title="Work page">
      {card.pageId ? (
        <div className="group flex h-8 items-center gap-2 rounded-md px-2 hover:bg-hover">
          <span className="flex w-4 shrink-0 justify-center text-fg-muted">{page?.icon ?? <FileText size="0.875rem" />}</span>
          <Link to={ws(`/d/${card.pageId}`)} className="min-w-0 flex-1 truncate hover:underline">
            {page ? page.title || 'Untitled' : loading ? '' : 'Missing page'}
            {page?.trashed && <span className="ml-1.5 text-sm text-fg-faint">(in trash)</span>}
          </Link>
          <Link
            to={ws(`/d/${card.pageId}`)}
            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-sm text-fg-muted hover:bg-hover hover:text-fg"
          >
            Open <ArrowUpRight size="0.75rem" />
          </Link>
          <IconButton
            size="sm"
            label="Unlink work page"
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => patchCard(data, card, { pageId: null })}
          >
            <Unlink size="0.75rem" />
          </IconButton>
        </div>
      ) : (
        <div className="px-2">
          <Button size="sm" icon={<FilePlus size="0.8125rem" />} onClick={create} disabled={loading}>
            Create work page
          </Button>
        </div>
      )}
    </Section>
  );
}
