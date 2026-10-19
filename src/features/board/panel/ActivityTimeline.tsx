import type { ReactNode } from 'react';
import type { Activity, ActivityValue, FieldDef, Priority } from '@shared/types';
import { actorName } from '@shared/actors';
import { Avatar } from '../../../components/Avatar';
import { absoluteTime, formatDate, PRIORITY_NAMES, relativeTime } from '../format';
import { useBoardData } from '../context';

const COLLAPSE_AFTER = 8;

/** An activity entry; `count` > 1 when repeated description edits were grouped into it. */
export type TimelineEntry = Activity & { count: number };

/** Activity tab: newest first; older entries behind "Show N older". */
export function ActivityTimeline({ entries, all, onShowAll }: { entries: readonly TimelineEntry[]; all: boolean; onShowAll(): void }) {
  const { project } = useBoardData();
  const shown = all ? entries : entries.slice(0, COLLAPSE_AFTER);

  return (
    <ol className="flex flex-col gap-1.5 px-2">
      {shown.map((e) => (
        <li key={e.id} className="flex items-start gap-2 text-sm leading-5 text-fg-muted">
          <Avatar actor={e.actor} size={16} className="mt-0.5" />
          <span className="min-w-0 flex-1">
            <span className="font-medium text-fg">{actorName(e.actor)}</span> {describe(e, project.fields)}
            {e.count > 1 && <span className="text-fg-faint"> ({e.count}×)</span>}
            <span className="text-fg-faint" title={absoluteTime(e.at)}>
              {' · '}
              {relativeTime(e.at)}
            </span>
          </span>
        </li>
      ))}
      {!all && entries.length > COLLAPSE_AFTER && (
        <li>
          <button type="button" onClick={onShowAll} className="text-sm text-fg-muted hover:text-fg hover:underline">
            Show {entries.length - COLLAPSE_AFTER} older
          </button>
        </li>
      )}
      {entries.length === 0 && <li className="text-sm text-fg-faint">No activity yet</li>}
    </ol>
  );
}

function B({ children }: { children: ReactNode }) {
  return <span className="font-medium text-fg">{children}</span>;
}

function list(values: string[]): ReactNode {
  return values.map((v, i) => (
    <span key={v}>
      {i > 0 && ', '}
      <B>{v}</B>
    </span>
  ));
}

function show(v: ActivityValue, field?: FieldDef): ReactNode {
  if (v === null || v === undefined || v === '') return <B>empty</B>;
  if (Array.isArray(v)) return v.length ? list(v) : <B>empty</B>;
  if (typeof v === 'boolean') return <B>{v ? 'checked' : 'unchecked'}</B>;
  if (field?.type === 'date' && typeof v === 'string') return <B>{formatDate(v)}</B>;
  return <B>{String(v)}</B>;
}

/** Human-readable activity line (after the actor's name). */
function describe(e: Activity, fields: readonly FieldDef[]): ReactNode {
  const { from = null, to = null } = e;
  switch (e.kind) {
    case 'created':
      return 'created the card';
    case 'status':
      return (
        <>
          moved it from {show(from)} to {show(to)}
        </>
      );
    case 'title':
      return <>renamed it to {show(to)}</>;
    case 'description':
      return 'edited the description';
    case 'priority':
      return to === 'none' || !to ? (
        'removed the priority'
      ) : (
        <>
          set priority to <B>{PRIORITY_NAMES[to as Priority] ?? String(to)}</B>
        </>
      );
    case 'labels': {
      const a = Array.isArray(from) ? from : [];
      const b = Array.isArray(to) ? to : [];
      const added = b.filter((l) => !a.includes(l));
      const removed = a.filter((l) => !b.includes(l));
      if (added.length && removed.length && added.length === 1 && removed.length === 1) {
        return (
          <>
            renamed label {list(removed)} to {list(added)}
          </>
        );
      }
      return (
        <>
          {added.length > 0 && <>added {added.length > 1 ? 'labels' : 'label'} {list(added)}</>}
          {added.length > 0 && removed.length > 0 && ' and '}
          {removed.length > 0 && <>removed {removed.length > 1 ? 'labels' : 'label'} {list(removed)}</>}
          {!added.length && !removed.length && 'changed labels'}
        </>
      );
    }
    case 'dueDate':
      return to ? (
        <>
          set the due date to <B>{formatDate(String(to))}</B>
        </>
      ) : (
        'removed the due date'
      );
    case 'field': {
      const def = fields.find((f) => f.key === e.field);
      const name = <B>{def?.name ?? e.field}</B>;
      return to === null ? (
        <>cleared {name}</>
      ) : (
        <>
          set {name} to {show(to, def)}
        </>
      );
    }
    case 'parent':
      return to ? <>set the parent to {show(to)}</> : <>removed the parent {from ? show(from) : null}</>;
    case 'archived':
      return to ? 'archived the card' : 'unarchived the card';
    case 'comment':
      return to ? 'commented' : 'deleted a comment';
    case 'attachment':
      return to ? <>attached {show(to)}</> : <>removed attachment {show(from)}</>;
    case 'page':
      return to ? 'linked a work page' : 'unlinked the work page';
    default:
      return `changed ${String(e.kind)}`;
  }
}
