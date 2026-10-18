import { memo, useState } from 'react';
import { Pencil, Trash } from 'lucide-react';
import type { Card, Comment } from '@shared/types';
import { addComment, deleteComment, updateComment, useComments } from '../../../data/comments';
import { useUser } from '../../../lib/auth';
import { Avatar } from '../../../components/Avatar';
import { Button } from '../../../components/Button';
import { IconButton } from '../../../components/IconButton';
import { MarkdownEditor, MarkdownView } from '../../../components/MarkdownEditor';
import { run } from '../context';
import { absoluteTime, relativeTime } from '../format';
import { Section } from './Section';

export function Comments({ card }: { card: Card }) {
  const { data: comments } = useComments(card.id);
  const user = useUser();

  return (
    <Section title="Comments" meta={comments.length > 0 && <span className="text-[11px] text-fg-faint">{comments.length}</span>}>
      <ul className="flex flex-col gap-3 px-2 pt-1">
        {comments.map((c) => (
          <CommentItem key={c.id} cardId={card.id} comment={c} mine={c.author.type === 'user' && c.author.id === user.uid} />
        ))}
      </ul>
      <Composer cardId={card.id} />
    </Section>
  );
}

function Composer({ cardId }: { cardId: string }) {
  const [draft, setDraft] = useState('');
  const [key, setKey] = useState(0);
  const empty = !draft.trim();

  const submit = () => {
    if (empty) return;
    const body = draft.trim();
    setDraft('');
    setKey((k) => k + 1);
    run(() => addComment(cardId, body));
  };

  return (
    <div className="mx-2 mt-3 rounded-md border border-line bg-surface focus-within:border-accent focus-within:ring-2 focus-within:ring-ring">
      <MarkdownEditor
        key={key}
        value=""
        onChange={setDraft}
        onSubmit={submit}
        placeholder="Leave a comment…"
        variant="compact"
        className="min-h-10 px-2.5 py-2 text-[13px]"
      />
      <div className="flex items-center justify-end gap-2 px-2 pb-2">
        <span className="text-[11px] text-fg-faint">⌘↵ to send</span>
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
        <div className="flex h-5 items-center gap-1.5 text-[12px]">
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
                <Pencil size={12} />
              </IconButton>
              <IconButton
                size="sm"
                label="Delete comment"
                className="hover:text-danger"
                onClick={() => confirm('Delete this comment?') && run(() => deleteComment(cardId, c.id))}
              >
                <Trash size={12} />
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
              className="min-h-10 px-2.5 py-2 text-[13px]"
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
          <MarkdownView value={c.body} variant="compact" className="text-[13px] break-words text-fg" />
        )}
      </div>
    </li>
  );
});
