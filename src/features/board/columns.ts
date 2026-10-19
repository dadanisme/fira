import { useCallback, useMemo, useState } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import type { Card, Column, Project } from '@shared/types';
import { newColumn, updateProject } from '../../data/projects';
import { deepEqual } from './hooks';
import { toastError } from './toast';

/**
 * Column management shared by the board and Settings. Writes are optimistic: the edited
 * list is shown until the Firestore snapshot echoes it (no snap-back after a drop),
 * and a failed write reverts with a toast.
 */
export interface ColumnsApi {
  columns: Column[];
  add(name: string): Column | undefined;
  rename(id: string, name: string): void;
  remove(id: string): void;
  /** Moves `id` to the index currently held by `overId`. */
  move(id: string, overId: string): void;
}

export function useColumns(project: Project): ColumnsApi {
  const remote = project.columns;
  const [pending, setPending] = useState<Column[] | null>(null);
  const synced = pending !== null && deepEqual(pending, remote);
  // The snapshot caught up: drop the override (render-time state adjustment, no extra effect pass).
  if (synced) setPending(null);
  const columns = pending && !synced ? pending : remote;

  const projectId = project.id;
  const save = useCallback(
    (next: Column[]) => {
      setPending(next);
      const revert = (err: unknown) => {
        toastError(err);
        setPending((p) => (p === next ? null : p));
      };
      try {
        updateProject(projectId, { columns: next }).catch(revert);
      } catch (err) {
        revert(err);
      }
    },
    [projectId],
  );

  return useMemo<ColumnsApi>(
    () => ({
      columns,
      add(name) {
        const n = name.trim();
        if (!n) return undefined;
        const col = newColumn(n);
        save([...columns, col]);
        return col;
      },
      rename(id, name) {
        const n = name.trim();
        if (!n || columns.find((c) => c.id === id)?.name === n) return;
        save(columns.map((c) => (c.id === id ? { ...c, name: n } : c)));
      },
      remove(id) {
        save(columns.filter((c) => c.id !== id));
      },
      move(id, overId) {
        const from = columns.findIndex((c) => c.id === id);
        const to = columns.findIndex((c) => c.id === overId);
        if (from < 0 || to < 0 || from === to) return;
        save(arrayMove(columns, from, to));
      },
    }),
    [columns, save],
  );
}

/** Cards per column id, archived included (a column can only be deleted when empty). */
export function columnCardCounts(cards: readonly Card[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cards) m.set(c.status, (m.get(c.status) ?? 0) + 1);
  return m;
}

/** Why a column can't be deleted, or null when it can. */
export function deleteBlockedReason(cardCount: number, columnCount: number): string | null {
  if (cardCount > 0) return `Move or delete its ${cardCount} card${cardCount === 1 ? '' : 's'} first (archived included)`;
  if (columnCount <= 1) return 'A project needs at least one column';
  return null;
}
