import { deleteDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { useMemo } from 'react';
import type { Card, Label, LabelColor } from '@shared/types';
import { colorFor, findLabel } from '@shared/labels';
import { currentActor } from './actor';
import { cardsCol, labelsCol, newDoc, rawDoc } from './db';
import { useLiveQuery, type Live } from './live';
import { commitInChunks, writeActivity } from './writes';

const allLabels = query(labelsCol);

/** All labels, sorted by name. */
export function useLabels(): Live<Label[]> {
  const live = useLiveQuery(allLabels);
  const data = useMemo(() => [...live.data].sort((a, b) => a.name.localeCompare(b.name)), [live.data]);
  return { ...live, data };
}

/**
 * Returns the existing label with this name (case-insensitive) or creates one.
 * Pass the current labels (from useLabels) so this stays synchronous and optimistic.
 */
export function ensureLabel(existing: readonly Label[], name: string, color?: LabelColor): Label {
  const trimmed = name.trim();
  const found = findLabel(existing, trimmed);
  if (found) return found;
  const ref = newDoc('labels');
  const label: Label = { id: ref.id, name: trimmed, color: color ?? colorFor(trimmed) };
  setDoc(ref, { name: label.name, color: label.color }).catch(reportError);
  return label;
}

export function setLabelColor(labelId: string, color: LabelColor): Promise<void> {
  return updateDoc(rawDoc('labels', labelId), { color });
}

/** Renames a label and every card using it (each card change is logged as a `labels` activity). */
export async function renameLabel(existing: readonly Label[], label: Label, name: string): Promise<void> {
  const trimmed = name.trim();
  const clash = findLabel(existing, trimmed);
  if (clash && clash.id !== label.id) throw new Error(`Label "${clash.name}" already exists`);
  await updateDoc(rawDoc('labels', label.id), { name: trimmed });
  await rewriteCardLabels(label.name, (labels) => labels.map((l) => (l === label.name ? trimmed : l)));
}

/** Deletes a label and removes it from every card (logged as `labels` activity). */
export async function deleteLabel(label: Label): Promise<void> {
  await deleteDoc(rawDoc('labels', label.id));
  await rewriteCardLabels(label.name, (labels) => labels.filter((l) => l !== label.name));
}

async function rewriteCardLabels(name: string, next: (labels: string[]) => string[]): Promise<void> {
  const actor = currentActor();
  const cards: Card[] = (await getDocs(query(cardsCol, where('labels', 'array-contains', name)))).docs.map((d) => d.data());
  await commitInChunks(
    cards.map((card) => (batch) => {
      const labels = next(card.labels);
      batch.update(rawDoc('cards', card.id), { labels, updatedAt: serverTimestamp(), updatedBy: actor });
      writeActivity(batch, card.id, [{ kind: 'labels', from: card.labels, to: labels }], actor);
    }),
    2,
  );
}
