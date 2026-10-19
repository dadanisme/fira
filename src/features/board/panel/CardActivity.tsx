import { useId, useMemo, useRef, useState } from 'react';
import type { Activity, Card } from '@shared/types';
import { useActivity } from '../../../data/activity';
import { useComments } from '../../../data/comments';
import { TabPanel, Tabs } from '../../../components/Tabs';
import { ActivityTimeline, type TimelineEntry } from './ActivityTimeline';
import { Comments } from './Comments';

type Tab = 'comments' | 'activity';

const STORAGE_KEY = 'fira.card.activityTab';

/** Consecutive description edits by one actor within this window show as one line. */
const MERGE_MS = 10 * 60 * 1000;

/**
 * Activity entries (oldest first, as from useActivity) as timeline lines, newest first.
 * Repeated description edits by one actor within MERGE_MS collapse into one line with a count.
 */
function timelineEntries(entries: readonly Activity[]): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  for (const e of entries) {
    const prev = out.at(-1);
    if (
      prev &&
      e.kind === 'description' &&
      prev.kind === 'description' &&
      prev.actor.id === e.actor.id &&
      Date.parse(e.at) - Date.parse(prev.at) < MERGE_MS
    ) {
      out[out.length - 1] = { ...e, count: prev.count + 1 };
    } else {
      out.push({ ...e, count: 1 });
    }
  }
  return out.reverse();
}

function storedTab(): Tab {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'activity' ? 'activity' : 'comments';
  } catch {
    return 'comments';
  }
}

/**
 * Bottom of the card dialog (Jira's "Activity" area): Comments and Activity tabs.
 * Both subscriptions stay live here (for the counts); only the active tab's list renders.
 */
export function CardActivity({ card }: { card: Card }) {
  const id = useId();
  const { data: comments } = useComments(card.id);
  const { data: activity } = useActivity(card.id);
  const entries = useMemo(() => timelineEntries(activity), [activity]);
  const [tab, setTab] = useState<Tab>(storedTab);
  const [allActivity, setAllActivity] = useState(false);

  // Never let the panel shrink below its tallest height so far: switching to a shorter
  // tab would otherwise collapse the dialog and jump its scroll position. Released when
  // the lists change size (e.g. a deleted comment), so the panel can shrink again.
  const panel = useRef<HTMLDivElement>(null);
  const sizeKey = `${comments.length}:${entries.length}`;
  const [floor, setFloor] = useState({ key: sizeKey, height: 0 });
  const minHeight = floor.key === sizeKey ? floor.height : 0;
  const select = (next: Tab) => {
    if (next === tab) return;
    setFloor({ key: sizeKey, height: Math.max(minHeight, panel.current?.offsetHeight ?? 0) });
    setTab(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable: the choice lasts for this dialog only.
    }
  };

  return (
    <section aria-label="Comments and activity" className="flex flex-col">
      <Tabs
        id={id}
        label="Comments and activity"
        value={tab}
        onChange={select}
        items={[
          { value: 'comments', label: 'Comments', count: comments.length },
          { value: 'activity', label: 'Activity', count: entries.length },
        ]}
        className="mx-2"
      />
      <div ref={panel} style={{ minHeight }} className="pt-3">
        <TabPanel id={id} value={tab}>
          {tab === 'comments' ? (
            <Comments card={card} comments={comments} />
          ) : (
            <ActivityTimeline entries={entries} all={allActivity} onShowAll={() => setAllActivity(true)} />
          )}
        </TabPanel>
      </div>
    </section>
  );
}
