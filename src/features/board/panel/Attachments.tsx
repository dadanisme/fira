import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Download, File as FileIcon, Paperclip, Trash } from 'lucide-react';
import type { Attachment, Card } from '@shared/types';
import { attachmentUrl, deleteAttachment, uploadAttachment, useAttachments } from '../../../data/attachments';
import { IconButton } from '../../../components/IconButton';
import { cx } from '../../../lib/cx';
import { run } from '../context';
import { absoluteTime, formatBytes, relativeTime } from '../format';
import { toastError } from '../toast';
import { Section } from './Section';

/** Download URLs, cached per storage path for the session. */
const urlCache = new Map<string, Promise<string>>();
function cachedUrl(a: Attachment): Promise<string> {
  let p = urlCache.get(a.storagePath);
  if (!p) {
    p = attachmentUrl(a);
    p.catch(() => urlCache.delete(a.storagePath));
    urlCache.set(a.storagePath, p);
  }
  return p;
}

export function Attachments({ card }: { card: Card }) {
  const { data: attachments } = useAttachments(card.id);
  const [uploading, setUploading] = useState<{ id: number; name: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const nextId = useRef(1);

  const upload = (files: FileList | File[]) => {
    for (const file of files) {
      const id = nextId.current++;
      setUploading((u) => [...u, { id, name: file.name }]);
      uploadAttachment(card.id, file)
        .catch(toastError)
        .finally(() => setUploading((u) => u.filter((x) => x.id !== id)));
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
  };

  return (
    <Section
      title="Attachments"
      meta={attachments.length > 0 && <span className="text-[11px] text-fg-faint">{attachments.length}</span>}
      action={
        <IconButton size="sm" label="Attach files" onClick={() => input.current?.click()} className="size-6">
          <Paperclip size={13} />
        </IconButton>
      }
    >
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) upload(e.target.files);
          e.target.value = '';
        }}
      />
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cx('rounded-md', dragOver && 'bg-accent-soft ring-2 ring-accent/40')}
      >
        {attachments.length === 0 && uploading.length === 0 ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-[13px] text-fg-faint hover:bg-hover hover:text-fg-muted"
          >
            <Paperclip size={13} /> Drop files or click to attach
          </button>
        ) : (
          <ul className="flex flex-col">
            {attachments.map((a) => (
              <AttachmentRow key={a.id} cardId={card.id} attachment={a} />
            ))}
            {uploading.map((u) => (
              <li key={u.id} aria-busy="true" className="flex h-10 items-center gap-2 px-2 text-fg-faint">
                <span className="size-7 shrink-0 animate-pulse rounded bg-sunken" />
                <span className="truncate">{u.name}</span>
                <span className="text-xs">Uploading…</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

function AttachmentRow({ cardId, attachment: a }: { cardId: string; attachment: Attachment }) {
  const [url, setUrl] = useState<string | null>(null);
  const isImage = a.contentType.startsWith('image/');

  useEffect(() => {
    let live = true;
    cachedUrl(a).then(
      (u) => live && setUrl(u),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [a]);

  const remove = () => {
    if (confirm(`Delete “${a.name}”?`)) run(() => deleteAttachment(cardId, a));
  };

  return (
    <li className="group flex h-10 items-center gap-2 rounded-md px-2 hover:bg-hover">
      <span className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded bg-sunken text-fg-faint">
        {isImage && url ? <img src={url} alt="" loading="lazy" className="size-full object-cover" /> : <FileIcon size={14} />}
      </span>
      <div className="min-w-0 flex-1">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="block truncate hover:underline">
            {a.name}
          </a>
        ) : (
          <span className="block truncate">{a.name}</span>
        )}
        <span className="block text-[11px] text-fg-faint" title={absoluteTime(a.createdAt)}>
          {formatBytes(a.size)} · {a.uploadedBy.name} · {relativeTime(a.createdAt)}
        </span>
      </div>
      <a
        href={url ?? undefined}
        download={a.name}
        target="_blank"
        rel="noreferrer"
        aria-label={`Download ${a.name}`}
        title="Download"
        aria-disabled={!url}
        className="inline-flex size-6 items-center justify-center rounded-md text-fg-muted opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100"
      >
        <Download size={13} />
      </a>
      <IconButton
        size="sm"
        label={`Delete ${a.name}`}
        onClick={remove}
        className="size-6 opacity-0 group-hover:opacity-100 hover:text-danger focus-visible:opacity-100"
      >
        <Trash size={13} />
      </IconButton>
    </li>
  );
}
