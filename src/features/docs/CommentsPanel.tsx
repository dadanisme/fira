import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import type { Thread } from '@shared/types';
import { createThread, replyToThread, setThreadResolved } from '../../data/threads';
import { Avatar } from '../../components/Avatar';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { MarkdownEditor, MarkdownView, type CommentAnchor } from '../../components/MarkdownEditor';
import { cx } from '../../lib/cx';
import { timeAgo } from './format';

export type PendingAnchor = Omit<CommentAnchor, 'id'>;

export interface CommentsPanelProps {
  pageId: string;
  threads: Thread[];
  /** Whether resolved threads are listed (toggled from the page header). */
  showResolved: boolean;
  /** Thread id → top offset (px) in the panel's coordinate space; absent = orphaned. */
  positions: Record<string, number>;
  /** Cards follow their highlight (wide screens); otherwise a plain list. */
  aligned: boolean;
  activeId: string | null;
  onActivate(id: string | null): void;
  pending: PendingAnchor | null;
  /** Top offset for the new-thread composer (aligned mode). */
  pendingTop: number;
  onPendingDone(createdId: string | null): void;
}

const GAP = 8;

export function CommentsPanel(props: CommentsPanelProps) {
  const { threads, positions, aligned, pending, showResolved } = props;
  const visible = useMemo(() => threads.filter((t) => showResolved || !t.resolved), [threads, showResolved]);
  const anchored = useMemo(
    () => visible.filter((t) => positions[t.id] !== undefined).sort((a, b) => positions[a.id] - positions[b.id]),
    [visible, positions],
  );
  const orphaned = useMemo(
    () => visible.filter((t) => positions[t.id] === undefined).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [visible, positions],
  );
  const resolvedCount = threads.filter((t) => t.resolved).length;

  // Aligned layout: each card wants its highlight's top; push down to avoid overlaps.
  // Orphaned threads sit at the top (they have no highlight to follow), anchored ones flow below them.
  const refs = useRef(new Map<string, HTMLElement>());
  const orphansRef = useRef<HTMLDivElement>(null);
  const [tops, setTops] = useState<Record<string, number>>({});
  const [bottom, setBottom] = useState(0);
  useLayoutEffect(() => {
    if (!aligned) return;
    const entries: { id: string; want: number }[] = anchored.map((t) => ({ id: t.id, want: positions[t.id] }));
    if (pending) entries.push({ id: 'pending', want: props.pendingTop });
    entries.sort((a, b) => a.want - b.want);
    const next: Record<string, number> = {};
    let end = orphansRef.current ? orphansRef.current.offsetHeight + 16 : 0;
    for (const e of entries) {
      const top = Math.max(e.want, end);
      next[e.id] = top;
      end = top + (refs.current.get(e.id)?.offsetHeight ?? 80) + GAP;
    }
    setBottom(end);
    setTops((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  });

  const card = (t: Thread) => (
    <ThreadCard
      key={t.id}
      pageId={props.pageId}
      thread={t}
      active={props.activeId === t.id}
      onActivate={() => props.onActivate(t.id)}
      ref={(el) => {
        if (el) refs.current.set(t.id, el);
        else refs.current.delete(t.id);
      }}
      style={aligned ? { position: 'absolute', top: tops[t.id] ?? positions[t.id], left: 0, right: 0 } : undefined}
    />
  );

  return (
    // Aligned: fill the aside (the article's height) so the sticky header stays up for the whole page.
    <div className={cx('flex flex-col gap-2', aligned && 'min-h-full')}>
      <div className="sticky top-0 z-10 -mx-1 flex h-6 items-center justify-between bg-bg px-1 text-xs font-medium text-fg-faint">
        <span>Comments{visible.length > 0 && ` · ${visible.length}`}</span>
      </div>
      <div className={cx(aligned && 'relative')} style={aligned ? { minHeight: bottom } : undefined}>
        {orphaned.length > 0 && (
          <div ref={orphansRef} className={cx('flex flex-col gap-2', aligned && 'absolute top-0 right-0 left-0', !aligned && 'mb-2')}>
            <div className="text-xs font-medium text-fg-faint">Text no longer found</div>
            {orphaned.map((t) => (
              <ThreadCard key={t.id} pageId={props.pageId} thread={t} active={props.activeId === t.id} onActivate={() => props.onActivate(t.id)} />
            ))}
          </div>
        )}
        {pending && (
          <NewThread
            pageId={props.pageId}
            anchor={pending}
            onDone={props.onPendingDone}
            ref={(el) => {
              if (el) refs.current.set('pending', el);
              else refs.current.delete('pending');
            }}
            style={aligned ? { position: 'absolute', top: tops.pending ?? props.pendingTop, left: 0, right: 0 } : undefined}
          />
        )}
        <div className={cx(!aligned && 'flex flex-col gap-2')}>{anchored.map(card)}</div>
        {visible.length === 0 && !pending && (
          <p className="text-sm text-fg-faint">
            {resolvedCount > 0 ? 'All comments are resolved. ' : ''}Select text and choose Comment to start a thread.
          </p>
        )}
      </div>
    </div>
  );
}

function Quote({ text }: { text: string }) {
  return <div className="line-clamp-2 border-l-2 border-warning pl-2 text-sm text-fg-muted italic">{text}</div>;
}

function ThreadCard({
  pageId,
  thread,
  active,
  onActivate,
  ref,
  style,
}: {
  pageId: string;
  thread: Thread;
  active: boolean;
  onActivate(): void;
  ref?: (el: HTMLElement | null) => void;
  style?: CSSProperties;
}) {
  const [reply, setReply] = useState<string | null>(null);
  const send = () => {
    const body = reply?.trim();
    if (!body) return;
    replyToThread(pageId, thread.id, body).catch(reportError);
    setReply(null);
  };
  return (
    <div
      ref={ref}
      style={style}
      data-thread-card={thread.id}
      onClick={onActivate}
      className={cx(
        'flex flex-col gap-2 rounded-lg border bg-surface p-2.5 transition-[top,box-shadow]',
        active ? 'border-line-strong shadow-popover' : 'border-line shadow-card',
        thread.resolved && 'opacity-70',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Quote text={thread.quote} />
        </div>
        <IconButton
          size="sm"
          label={thread.resolved ? 'Reopen' : 'Resolve'}
          onClick={(e) => {
            e.stopPropagation();
            setThreadResolved(pageId, thread.id, !thread.resolved).catch(reportError);
          }}
        >
          {thread.resolved ? <RotateCcw size="0.8125rem" /> : <Check size="0.875rem" />}
        </IconButton>
      </div>
      {thread.messages.map((m) => (
        <div key={m.id} className="flex flex-col gap-1">
          <div className="flex items-center gap-1.5 text-sm">
            <Avatar actor={m.author} size={16} />
            <span className="font-medium">{m.author.name}</span>
            <span className="text-fg-faint">{timeAgo(m.createdAt)}</span>
          </div>
          <MarkdownView value={m.body} className="pl-5.5" />
        </div>
      ))}
      {active &&
        (reply === null ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setReply('');
            }}
            className="h-7 rounded-md border border-line px-2 text-left text-sm text-fg-faint hover:bg-hover"
          >
            Reply…
          </button>
        ) : (
          <div className="flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
            <div className="rounded-md border border-line px-2 py-1.5 focus-within:border-accent">
              <MarkdownEditor value={reply} onChange={setReply} placeholder="Reply…" autoFocus onSubmit={send} onCancel={() => setReply(null)} />
            </div>
            <div className="flex justify-end gap-1">
              <Button size="sm" variant="ghost" onClick={() => setReply(null)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" disabled={!reply.trim()} onClick={send}>
                Reply
              </Button>
            </div>
          </div>
        ))}
    </div>
  );
}

function NewThread({
  pageId,
  anchor,
  onDone,
  ref,
  style,
}: {
  pageId: string;
  anchor: PendingAnchor;
  onDone(id: string | null): void;
  ref?: (el: HTMLElement | null) => void;
  style?: CSSProperties;
}) {
  const [body, setBody] = useState('');
  const submit = () => {
    if (!body.trim()) return;
    onDone(createThread(pageId, { ...anchor, body: body.trim() }));
  };
  return (
    <div ref={ref} style={style} className="z-10 flex flex-col gap-2 rounded-lg border border-line-strong bg-surface p-2.5 shadow-popover">
      <Quote text={anchor.quote} />
      <div className="rounded-md border border-line px-2 py-1.5 focus-within:border-accent">
        <MarkdownEditor value={body} onChange={setBody} placeholder="Add a comment…" autoFocus onSubmit={submit} onCancel={() => onDone(null)} />
      </div>
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={() => onDone(null)}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" disabled={!body.trim()} onClick={submit}>
          Comment
        </Button>
      </div>
    </div>
  );
}
