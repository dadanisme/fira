import { useState, type FormEvent } from 'react';
import { Plus, Trash } from 'lucide-react';
import type { Label, LabelColor } from '@shared/types';
import { colorFor, findLabel } from '@shared/labels';
import { deleteLabel, ensureLabel, renameLabel, setLabelColor, useLabels } from '../../data/labels';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { Popover } from '../../components/Popover';
import { run } from '../board/context';
import { useDelayedFlag } from '../board/hooks';
import { EditableText } from '../board/panel/EditableText';
import { ColorSwatches } from '../board/pickers';
import { PageTitle, RowList } from './ui';
import { confirmAction } from '../../components/ConfirmDialog';

export function LabelsSettings() {
  const { data: labels, loading } = useLabels();
  const slow = useDelayedFlag(loading);
  const [name, setName] = useState('');
  const [color, setColor] = useState<LabelColor | null>(null);
  const trimmed = name.trim();
  const clash = trimmed ? findLabel(labels, trimmed) : undefined;

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed || clash) return;
    run(() => ensureLabel(labels, trimmed, color ?? colorFor(trimmed)));
    setName('');
    setColor(null);
  };

  return (
    <>
      <PageTitle title="Labels" description="Shared by all projects. Renaming or deleting a label updates every card that uses it." />
      {loading ? (
        slow && <p className="text-fg-faint">Loading…</p>
      ) : labels.length ? (
        <RowList>
          {labels.map((l) => (
            <LabelRow key={l.id} label={l} labels={labels} />
          ))}
        </RowList>
      ) : (
        <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-fg-faint">
          No labels yet. Create them here or on the fly from a card.
        </p>
      )}
      <form onSubmit={add} className="mt-3 flex flex-col gap-2">
        <div className="flex gap-2">
          <Input aria-label="New label name" placeholder="New label" value={name} onChange={(e) => setName(e.target.value)} className="w-56" />
          <Button type="submit" icon={<Plus size="0.8125rem" />} disabled={!trimmed || Boolean(clash)}>
            Add label
          </Button>
          {trimmed && <Badge color={color ?? colorFor(trimmed)}>{trimmed}</Badge>}
        </div>
        {trimmed && (clash ? <p className="text-sm text-danger">“{clash.name}” already exists</p> : <ColorSwatches value={color ?? colorFor(trimmed)} onChange={setColor} />)}
      </form>
    </>
  );
}

function LabelRow({ label, labels }: { label: Label; labels: readonly Label[] }) {
  return (
    <li className="flex h-10 items-center gap-2 px-2">
      <Popover
        className="p-2"
        trigger={(p) => (
          <button
            {...p}
            type="button"
            aria-label={`Color of ${label.name}: ${label.color}`}
            className="flex size-6 items-center justify-center rounded-md hover:bg-hover"
          >
            <span className="size-3 rounded-full" style={{ background: `var(--label-${label.color}-fg)` }} />
          </button>
        )}
      >
        {({ close }) => (
          <ColorSwatches
            value={label.color}
            onChange={(c) => {
              run(() => setLabelColor(label.id, c));
              close();
            }}
            className="w-31"
          />
        )}
      </Popover>
      <div className="min-w-0 flex-1">
        <EditableText label="Label name" value={label.name} allowEmpty={false} onCommit={(n) => run(() => renameLabel(labels, label, n))} />
      </div>
      <Badge color={label.color}>{label.name}</Badge>
      <IconButton
        label={`Delete ${label.name}`}
        className="hover:text-danger"
        onClick={() =>
          void confirmAction({
            title: `Delete label “${label.name}”?`,
            body: 'It is removed from every card.',
            confirmLabel: 'Delete',
            danger: true,
          }).then((ok) => ok && run(() => deleteLabel(label)))
        }
      >
        <Trash size="0.8125rem" />
      </IconButton>
    </li>
  );
}
