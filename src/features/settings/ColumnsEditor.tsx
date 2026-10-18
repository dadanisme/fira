import { useMemo, useState, type FormEvent } from 'react';
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash } from 'lucide-react';
import type { Column, Project } from '@shared/types';
import { useCards } from '../../data/cards';
import { newColumn, updateProject } from '../../data/projects';
import { Button } from '../../components/Button';
import { IconButton } from '../../components/IconButton';
import { Input } from '../../components/Input';
import { cx } from '../../lib/cx';
import { run } from '../board/context';
import { EditableText } from '../board/panel/EditableText';
import { RowList, SettingsSection } from './ui';

export function ColumnsEditor({ project }: { project: Project }) {
  const { data: cards } = useCards(project.id);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) m.set(c.status, (m.get(c.status) ?? 0) + 1);
    return m;
  }, [cards]);
  const [name, setName] = useState('');

  // Keep a dropped order until the snapshot echoes it (no snap-back).
  const [order, setOrder] = useState<string[] | null>(null);
  const remoteOrder = project.columns.map((c) => c.id).join();
  const columns = useMemo(() => {
    if (!order || order.join() === remoteOrder) return project.columns;
    const byId = new Map(project.columns.map((c) => [c.id, c]));
    return order.map((id) => byId.get(id)).filter((c): c is Column => !!c);
  }, [order, remoteOrder, project.columns]);

  const save = (next: Column[]) => run(() => updateProject(project.id, { columns: next }));

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = columns.findIndex((c) => c.id === active.id);
    const to = columns.findIndex((c) => c.id === over.id);
    const next = arrayMove(columns, from, to);
    setOrder(next.map((c) => c.id));
    save(next);
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setName('');
    save([...columns, newColumn(n)]);
  };

  return (
    <SettingsSection title="Columns" description="Drag to reorder. The last column counts as done.">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={columns.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          <RowList>
            {columns.map((col, i) => (
              <ColumnRow
                key={col.id}
                column={col}
                count={counts.get(col.id) ?? 0}
                isDone={i === columns.length - 1}
                canDelete={columns.length > 1}
                onRename={(n) => save(columns.map((c) => (c.id === col.id ? { ...c, name: n } : c)))}
                onDelete={() => save(columns.filter((c) => c.id !== col.id))}
              />
            ))}
          </RowList>
        </SortableContext>
      </DndContext>
      <form onSubmit={add} className="mt-2 flex gap-2">
        <Input aria-label="New column name" placeholder="New column" value={name} onChange={(e) => setName(e.target.value)} className="w-56" />
        <Button type="submit" icon={<Plus size={13} />} disabled={!name.trim()}>
          Add column
        </Button>
      </form>
    </SettingsSection>
  );
}

function ColumnRow({
  column,
  count,
  isDone,
  canDelete,
  onRename,
  onDelete,
}: {
  column: Column;
  count: number;
  isDone: boolean;
  canDelete: boolean;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: column.id });
  const blocked = count > 0 ? `Move or delete its ${count} card${count === 1 ? '' : 's'} first` : !canDelete ? 'A project needs a column' : null;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cx('flex h-10 items-center gap-1 bg-surface px-1.5 first:rounded-t-lg last:rounded-b-lg', isDragging && 'relative z-10 shadow-popover')}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={`Reorder ${column.name}`}
        {...attributes}
        {...listeners}
        className="flex size-6 cursor-grab items-center justify-center rounded text-fg-faint hover:bg-hover hover:text-fg-muted active:cursor-grabbing"
      >
        <GripVertical size={14} />
      </button>
      <div className="min-w-0 flex-1">
        <EditableText label="Column name" value={column.name} allowEmpty={false} onCommit={(n) => onRename(n.trim())} />
      </div>
      {isDone && <span className="rounded bg-[var(--label-green-bg)] px-1.5 text-[11px] text-[var(--label-green-fg)]">Done</span>}
      <span className="w-16 text-right text-xs text-fg-faint tabular-nums">
        {count} card{count === 1 ? '' : 's'}
      </span>
      <span title={blocked ?? undefined}>
        <IconButton
          label={blocked ?? `Delete ${column.name}`}
          disabled={Boolean(blocked)}
          onClick={() => confirm(`Delete column “${column.name}”?`) && onDelete()}
          className="hover:text-danger"
        >
          <Trash size={13} />
        </IconButton>
      </span>
    </li>
  );
}
