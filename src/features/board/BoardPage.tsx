import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Plus, Settings, Zap } from 'lucide-react';
import type { CardType } from '@shared/types';
import { rankAfterLast } from '@shared/rank';
import { createCard, useCards } from '../../data/cards';
import { useLabels } from '../../data/labels';
import { useProject } from '../../data/projects';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Popover } from '../../components/Popover';
import { cx } from '../../lib/cx';
import { Board } from './Board';
import { BoardDataProvider, useBoardData } from './context';
import { FilterBar } from './FilterBar';
import { parseFilters } from './filters';
import { useDelayedFlag, useStableList } from './hooks';
import { CardDialog } from './panel/CardDialog';
import { toastError, Toasts } from './toast';
import { LabelsProvider } from './ui';

/** `/p/:projectKey/:cardKey?`: the board, plus the card dialog when a card key is present. */
export default function BoardPage() {
  const { projectKey, cardKey } = useParams();
  const { data: project, loading } = useProject(projectKey);
  const cardsLive = useCards(project?.id);
  const cards = useStableList(cardsLive.data);
  const labels = useStableList(useLabels().data);
  const location = useLocation();
  const navigate = useNavigate();
  const search = location.search;
  const filters = useMemo(() => parseFilters(new URLSearchParams(search)), [search]);
  const slow = useDelayedFlag(loading || cardsLive.loading);

  // Stable across navigations so memoized tiles don't re-render when the dialog opens.
  const searchRef = useRef(search);
  searchRef.current = search;
  const key = project?.key;
  const onOpen = useCallback(
    (cardKey: string) => navigate({ pathname: `/p/${key}/${cardKey}`, search: searchRef.current }),
    [navigate, key],
  );
  const onClose = useCallback(() => navigate({ pathname: `/p/${key}`, search: searchRef.current }), [navigate, key]);

  // The dialog stays mounted for its exit animation after the URL drops the card key.
  const openKey = key && cardKey ? `${key}/${cardKey.toUpperCase()}` : undefined;
  const [shownKey, setShownKey] = useState(openKey);
  if (openKey && openKey !== shownKey) setShownKey(openKey);
  const onExited = useCallback(() => setShownKey(undefined), []);

  if (loading) return slow ? <BoardSkeleton /> : null;
  if (!project) {
    return (
      <div className="flex flex-1 items-center justify-center text-fg-muted">
        <div className="text-center">
          <p>No project with key “{projectKey}”.</p>
          <Link to="/" className="text-accent hover:underline">
            Go home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <LabelsProvider labels={labels}>
      <BoardDataProvider project={project} cards={cards} labels={labels}>
        <div className="relative flex min-h-0 flex-1 flex-col">
          <header className="flex h-11 shrink-0 items-center gap-2 pr-4 pl-[calc(1rem+var(--shell-gutter,0rem))]">
            <span className="rounded bg-sunken px-1.5 py-0.5 font-mono text-xs font-semibold text-fg-muted">{project.key}</span>
            <h1 className="truncate text-md font-semibold">{project.name}</h1>
            <span className="flex-1" />
            <NewCardButton onCreated={onOpen} />
            <Link
              to={`/settings/projects/${project.key}`}
              aria-label="Project settings"
              title="Project settings"
              className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg"
            >
              <Settings size="0.9375rem" />
            </Link>
          </header>
          <FilterBar filters={filters} />
          {cardsLive.loading ? (
            slow && <ColumnsSkeleton count={project.columns.length} />
          ) : (
            <Board filters={filters} selectedKey={cardKey?.toUpperCase()} onOpen={onOpen} />
          )}
          {shownKey?.startsWith(`${project.key}/`) && (
            <CardDialog
              cardKey={shownKey.slice(project.key.length + 1)}
              open={shownKey === openKey}
              loading={cardsLive.loading}
              onClose={onClose}
              onExited={onExited}
              onOpen={onOpen}
            />
          )}
        </div>
        <Toasts />
      </BoardDataProvider>
    </LabelsProvider>
  );
}

/** Header "New" button with a type picker (card or epic). */
function NewCardButton({ onCreated }: { onCreated: (key: string) => void }) {
  const { project, cards } = useBoardData();
  const [type, setType] = useState<CardType>('card');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent, close: () => void) => {
    e.preventDefault();
    const t = title.trim();
    if (!t || busy) return;
    const first = project.columns[0]?.id;
    setBusy(true);
    try {
      const rank = rankAfterLast(cards.filter((c) => c.status === first));
      const { key } = await createCard(project, { title: t, type, rank, status: first });
      setTitle('');
      close();
      onCreated(key);
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover
      placement="bottom-end"
      className="w-80 p-3"
      trigger={(props) => (
        <Button {...props} size="sm" variant="primary" icon={<Plus size="0.8125rem" />}>
          New
        </Button>
      )}
    >
      {({ close }) => (
        <form onSubmit={(e) => void submit(e, close)} className="flex flex-col gap-2">
          <div role="radiogroup" aria-label="Type" className="flex gap-1 rounded-md bg-sunken p-0.5">
            {(['card', 'epic'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => setType(t)}
                className={cx(
                  'flex h-6 flex-1 items-center justify-center gap-1 rounded text-sm',
                  type === t ? 'bg-surface font-medium text-fg shadow-card' : 'text-fg-muted hover:text-fg',
                )}
              >
                {t === 'epic' && <Zap size="0.75rem" />}
                {t === 'card' ? 'Card' : 'Epic'}
              </button>
            ))}
          </div>
          <Input
            autoFocus
            aria-label="Title"
            placeholder={type === 'epic' ? 'Epic title' : 'Card title'}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Button type="submit" variant="primary" disabled={!title.trim() || busy}>
            {busy ? 'Creating…' : `Create ${type}`}
          </Button>
        </form>
      )}
    </Popover>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="h-11" />
      <ColumnsSkeleton count={3} />
    </div>
  );
}

function ColumnsSkeleton({ count }: { count: number }) {
  return (
    <div aria-busy="true" aria-label="Loading board" className="flex gap-3 px-4 pt-1">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="h-48 w-72 shrink-0 animate-pulse rounded-lg bg-sunken/70" />
      ))}
    </div>
  );
}
