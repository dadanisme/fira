import { useMemo } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import type { Page, Project } from '@shared/types';
import { byRank } from '@shared/rank';
import { usePages } from '../../data/pages';
import { updateProject, type ProjectPatch } from '../../data/projects';
import { useWsPath } from '../../data/workspace';
import { Select } from '../../components/Select';
import { run } from '../board/context';
import { EditableText } from '../board/panel/EditableText';
import { ColumnsEditor } from './ColumnsEditor';
import { FieldsEditor } from './FieldsEditor';
import { PageTitle, RowList, SettingRow, SettingsSection } from './ui';

export function ProjectSettings({ project }: { project: Project }) {
  const update = (patch: ProjectPatch) => run(() => updateProject(project.id, patch));
  const { data: pages } = usePages();
  const ws = useWsPath();

  const live = useMemo(() => pages.filter((p) => !p.trashed), [pages]);
  const templates = useMemo(() => live.filter((p) => p.isTemplate).sort((a, b) => a.title.localeCompare(b.title)), [live]);
  const tree = useMemo(() => pageTree(live.filter((p) => !p.isTemplate)), [live]);
  const templateMissing = project.pageTemplateId && !templates.some((t) => t.id === project.pageTemplateId);
  const parentMissing = project.pageParentId && !tree.some(({ page }) => page.id === project.pageParentId);

  return (
    <>
      <PageTitle
        title={
          <span className="flex items-center gap-2">
            <span className="rounded bg-sunken px-1.5 py-0.5 font-mono text-sm text-fg-muted">{project.key}</span>
            {project.name}
          </span>
        }
      >
        <Link
          to={ws(`/p/${project.key}`)}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-base text-fg-muted hover:bg-hover hover:text-fg"
        >
          Open board <ArrowUpRight size="0.8125rem" />
        </Link>
      </PageTitle>

      <SettingsSection title="General">
        <RowList>
          <li>
            <SettingRow label="Name">
              <EditableText
                label="Project name"
                value={project.name}
                allowEmpty={false}
                onCommit={(name) => update({ name: name.trim() })}
                className="text-right"
              />
            </SettingRow>
          </li>
          <li>
            <SettingRow label="Key" hint="Prefixes card keys; can't change">
              <span className="px-2 font-mono text-fg-muted">{project.key}</span>
            </SettingRow>
          </li>
        </RowList>
      </SettingsSection>

      <SettingsSection title="Work pages" description="“Create work page” on a card copies the template into the parent page.">
        <RowList>
          <li>
            <SettingRow label="Template" hint={templates.length === 0 ? 'Mark a page as template in Docs' : undefined}>
              <Select
                aria-label="Work page template"
                className="w-64"
                value={project.pageTemplateId ?? ''}
                onChange={(e) => update({ pageTemplateId: e.target.value || null })}
              >
                <option value="">Blank page</option>
                {templateMissing && <option value={project.pageTemplateId}>(missing template)</option>}
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.icon ? `${t.icon} ` : ''}
                    {t.title || 'Untitled'}
                  </option>
                ))}
              </Select>
            </SettingRow>
          </li>
          <li>
            <SettingRow label="Parent page">
              <Select
                aria-label="Work page parent"
                className="w-64"
                value={project.pageParentId ?? ''}
                onChange={(e) => update({ pageParentId: e.target.value || null })}
              >
                <option value="">Top level</option>
                {parentMissing && <option value={project.pageParentId}>(missing page)</option>}
                {tree.map(({ page, depth }) => (
                  <option key={page.id} value={page.id}>
                    {'  '.repeat(depth)}
                    {page.icon ? `${page.icon} ` : ''}
                    {page.title || 'Untitled'}
                  </option>
                ))}
              </Select>
            </SettingRow>
          </li>
        </RowList>
      </SettingsSection>

      <ColumnsEditor project={project} />
      <FieldsEditor project={project} />
    </>
  );
}

/** Pages in tree order (depth first, by rank) with their depth. */
function pageTree(pages: readonly Page[]): { page: Page; depth: number }[] {
  const ids = new Set(pages.map((p) => p.id));
  const children = new Map<string | null, Page[]>();
  for (const p of pages) {
    const parent = p.parentId && ids.has(p.parentId) ? p.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), p]);
  }
  const out: { page: Page; depth: number }[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const p of (children.get(parent) ?? []).sort(byRank)) {
      out.push({ page: p, depth });
      visit(p.id, depth + 1);
    }
  };
  visit(null, 0);
  return out;
}
