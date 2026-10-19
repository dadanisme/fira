import { memo, useMemo, useRef, useState } from 'react';
import { Pencil, Trash } from 'lucide-react';
import type { Card, Comment } from '@shared/types';
import { addComment, deleteComment, updateComment } from '../../../data/comments';
import { useUser } from '../../../lib/auth';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { IconButton } from '../../../components/IconButton';
import { MarkdownEditor, MarkdownView, type MarkdownEditorHandle } from '../../../components/MarkdownEditor';
import { run } from '../context';
import { absoluteTime, relativeTime } from '../format';
import { blurActive } from '../hooks';

/** Comments tab: composer on top, comments newest first. `comments` come oldest first from useComments. */
export function Comments({ card, comments }: { card: Card; comments: readonly Comment[] }) {
  const user = useUser();
  const newestFirst = useMemo(() => [...comments].reverse(), [comments]);

  return (
    <div className="flex flex-col gap-4">
      <Composer cardId={card.id} />
      {newestFirst.length > 0 ? (
        <ul className="flex flex-col gap-3 px-2">
          {newestFirst.map((c) => (
            <CommentItem key={c.id} cardId={card.id} comment={c} mine={c.author.type === 'user' && c.author.id === user.uid} />
          ))}
        </ul>
      ) : (
        <p className="px-2 text-sm text-fg-faint">No comments yet</p>
      )}
    </div>
  );
}

function Composer({ cardId }: { cardId: string }) {
  const [draft, setDraft] = useState('');
  const editor = useRef<MarkdownEditorHandle>(null);
  const empty = !draft.trim();

  const submit = () => {
    if (empty) return;
    const body = draft.trim();
    // Clearing the value empties the editor in place (no remount), so it keeps focus.
    setDraft('');
    editor.current?.focus();
    run(() => addComment(cardId, body));
  };

  return (
    <div className="mx-2 rounded-md border border-line bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-ring">
      <MarkdownEditor
        ref={editor}
        value={draft}
        onChange={setDraft}
        onSubmit={submit}
        onCancel={blurActive}
        placeholder="Leave a comment…"
        variant="compact"
        className="min-h-10 px-2.5 py-2 text-base"
      />
      <div className="flex items-center justify-end gap-2 px-2 pb-2">
        <span className="text-xs text-fg-faint">⌘↵ to send</span>
        <Button size="sm" variant="primary" disabled={empty} onClick={submit}>
          Comment
        </Button>
      </div>
    </div>
  );
}

const CommentItem = memo(function CommentItem({ cardId, comment: c, mine }: { cardId: string; comment: Comment; mine: boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(c.body);

  const save = () => {
    const body = draft.trim();
    setEditing(false);
    if (body && body !== c.body) run(() => updateComment(cardId, c.id, body));
  };

  return (
    <li className="group flex gap-2">
      <Avatar actor={c.author} size={20} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex h-5 items-center gap-1.5 text-sm">
          <span className="font-medium text-fg">{c.author.name}</span>
          <span className="text-fg-faint" title={absoluteTime(c.createdAt)}>
            {relativeTime(c.createdAt)}
            {c.updatedAt && ' (edited)'}
          </span>
          <span className="flex-1" />
          {mine && !editing && (
            <span className="flex gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100">
              <IconButton
                size="sm"
                label="Edit comment"
                onClick={() => {
                  setDraft(c.body);
                  setEditing(true);
                }}
              >
                <Pencil size="0.75rem" />
              </IconButton>
              <IconButton
                size="sm"
                label="Delete comment"
                className="hover:text-danger"
                onClick={() => confirm('Delete this comment?') && run(() => deleteComment(cardId, c.id))}
              >
                <Trash size="0.75rem" />
              </IconButton>
            </span>
          )}
        </div>
        {editing ? (
          <div className="mt-1 rounded-md border border-accent bg-surface ring-2 ring-ring">
            <MarkdownEditor
              value={c.body}
              onChange={setDraft}
              onSubmit={save}
              onCancel={() => setEditing(false)}
              autoFocus
              variant="compact"
              className="min-h-10 px-2.5 py-2 text-base"
            />
            <div className="flex justify-end gap-1 px-2 pb-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" onClick={save}>
                Save
              </Button>
            </div>
          </div>
        ) : (
          <MarkdownView value={c.body} variant="compact" className="text-base break-words text-fg" />
        )}
      </div>
    </li>
  );
});
