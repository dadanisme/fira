import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Page } from '@shared/types';
import { restoreVersion, useVersions } from '../../data/pages';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { MarkdownView } from '../../components/MarkdownEditor';
import { cx } from '../../lib/cx';
import { pageTitle } from './actions';
import { dateTime, timeAgo } from './format';

/** Version history: list of snapshots, rendered preview, restore (saved as a new version). */
export function HistoryDrawer({ page, onClose, onBeforeRestore }: { page: Page; onClose(): void; onBeforeRestore(): void }) {
  const { data: versions, loading } = useVersions(page.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = versions.find((v) => v.id === selectedId) ?? versions[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-sunken/60" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-230 bg-bg shadow-popover">
        <div className="flex w-64 shrink-0 flex-col border-r border-line bg-sidebar">
          <div className="flex h-11 items-center justify-between px-3">
            <span className="text-base font-semibold">Version history</span>
            <IconButton label="Close" onClick={onClose} className="sm:hidden">
              <X size="0.9375rem" />
            </IconButton>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pb-2">
            {!loading && versions.length === 0 && <p className="px-2 text-sm text-fg-faint">No versions yet</p>}
            {versions.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelectedId(v.id)}
                className={cx(
                  'flex flex-col gap-0.5 rounded-md px-2 py-1.5 text-left',
                  v.id === selected?.id ? 'bg-active' : 'hover:bg-hover',
                )}
              >
                <span className="text-base font-medium text-fg">{timeAgo(v.savedAt)}</span>
                <span className="flex items-center gap-1.5 text-sm text-fg-muted">
                  <Avatar actor={v.actor} size={14} />
                  <span className="truncate">{v.actor.name}</span>
                  <span className="ml-auto text-fg-faint">v{v.version}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4">
            <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">
              {selected && `${dateTime(selected.savedAt)} · ${selected.actor.name}${selected.actor.type === 'token' ? ' (API)' : ''}`}
            </span>
            {selected && (
              <Button
                variant="primary"
                disabled={selected.version === page.version && selected.content === page.content && selected.title === page.title}
                onClick={() => {
                  onBeforeRestore();
                  restoreVersion(page, selected).catch(reportError);
                  onClose();
                }}
              >
                Restore this version
              </Button>
            )}
            <IconButton label="Close" onClick={onClose}>
              <X size="0.9375rem" />
            </IconButton>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-10 py-8">
            {selected && (
              <div className="mx-auto max-w-180">
                <h1 className="mb-4 text-3xl leading-tight font-bold tracking-tight">{pageTitle(selected)}</h1>
                <MarkdownView value={selected.content} variant="page" />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
