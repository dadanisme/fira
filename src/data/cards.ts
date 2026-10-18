import {
  deleteField,
  increment,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore';
import { useMemo } from 'react';
import type { Card, CardType, FieldValue, Priority, Project } from '@shared/types';
import type { ActivityContext, CardPatch } from '@shared/activity';
import { cardPatchActivity } from '@shared/activity';
import { formatCardKey, normalizeCardKey } from '@shared/keys';
import { db } from '../lib/firebase';
import { currentActor } from './actor';
import { cardsCol, newDoc, rawDoc, type Stored } from './db';
import { useLiveQuery, type Live } from './live';
import { writeActivity } from './writes';

export type { ActivityContext, CardPatch };

/** All cards of a project, archived and subtasks included (filter in the UI), unsorted. */
export function useCards(projectId: string | undefined): Live<Card[]> {
  const q = useMemo(() => (projectId ? query(cardsCol, where('projectId', '==', projectId)) : null), [projectId]);
  return useLiveQuery(q);
}

/** A card by key (`NI-12`, case-insensitive). */
export function useCard(key: string | undefined): Live<Card | null> {
  const normalized = key ? normalizeCardKey(key) : null;
  const q = useMemo(() => (normalized ? query(cardsCol, where('key', '==', normalized), limit(1)) : null), [normalized]);
  const live = useLiveQuery(q);
  return { ...live, data: live.data[0] ?? null };
}

export interface NewCard {
  title: string;
  /** Use rankAfterLast(cardsInColumn) to append. */
  rank: string;
  type?: CardType;
  /** Column id; defaults to the first column. */
  status?: string;
  parentId?: string;
  description?: string;
  priority?: Priority;
  labels?: string[];
  dueDate?: string;
  fields?: Record<string, FieldValue>;
}

/**
 * Creates a card, allocating its number from `project.nextNumber` in a transaction
 * (needs network; resolves once committed).
 */
export function createCard(project: Project, input: NewCard): Promise<{ id: string; key: string }> {
  const actor = currentActor();
  const ref = newDoc('cards');
  const projectRef = rawDoc('projects', project.id);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(projectRef);
    if (!snap.exists()) throw new Error('Project not found');
    const number = snap.get('nextNumber') as number;
    const key = formatCardKey(project.key, number);
    const card: Stored<Card, 'createdAt' | 'updatedAt'> = {
      projectId: project.id,
      key,
      number,
      type: input.type ?? 'card',
      parentId: input.parentId,
      title: input.title.trim(),
      description: input.description ?? '',
      descriptionVersion: 1,
      status: input.status ?? project.columns[0].id,
      rank: input.rank,
      priority: input.priority ?? 'none',
      labels: input.labels ?? [],
      dueDate: input.dueDate,
      fields: input.fields ?? {},
      archived: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: actor,
      updatedBy: actor,
    };
    tx.set(ref, card);
    tx.update(projectRef, { nextNumber: number + 1 });
    writeActivity(tx, ref.id, [{ kind: 'created' }], actor);
    return { id: ref.id, key };
  });
}

/**
 * Applies a patch to a card and writes the matching activity entries in the same
 * batch. `ctx.columns` must be the card's project columns (status names are logged).
 */
export function updateCard(card: Card, patch: CardPatch, ctx: ActivityContext): Promise<void> {
  const actor = currentActor();
  const data: DocumentData = { updatedAt: serverTimestamp(), updatedBy: actor };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'fields') {
      for (const [field, value] of Object.entries(v as NonNullable<CardPatch['fields']>)) {
        data[`fields.${field}`] = value === null ? deleteField() : value;
      }
    } else if (v !== undefined) {
      data[k] = v === null ? deleteField() : v;
    }
  }
  if (patch.description !== undefined && patch.description !== card.description) {
    data.descriptionVersion = increment(1);
  }
  const batch = writeBatch(db);
  batch.update(rawDoc('cards', card.id), data);
  writeActivity(batch, card.id, cardPatchActivity(card, patch, ctx), actor);
  return batch.commit();
}

/** Moves a card to a column and/or position (drag and drop). */
export function moveCard(card: Card, status: string, rank: string, ctx: ActivityContext): Promise<void> {
  return updateCard(card, status === card.status ? { rank } : { status, rank }, ctx);
}
