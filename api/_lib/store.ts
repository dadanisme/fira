import {
  FieldValue,
  type DocumentReference,
  type DocumentSnapshot,
} from 'firebase-admin/firestore';
import type { Activity, ActivityDraft, Actor, Card, Label, Page, Project } from '../../shared/types.js';
import { normalizeCardKey } from '../../shared/keys.js';
import { colorFor, findLabel } from '../../shared/labels.js';
import { statusName } from '../../shared/status.js';
import { firestore } from './admin.js';
import { notFound } from './http.js';
import { fromDoc } from './serialize.js';

/** Firestore access shared by the route modules. Document shapes match src/data exactly. */

export const col = {
  projects: () => firestore().collection('projects'),
  labels: () => firestore().collection('labels'),
  cards: () => firestore().collection('cards'),
  pages: () => firestore().collection('pages'),
  comments: (cardId: string) => firestore().collection('cards').doc(cardId).collection('comments'),
  activity: (cardId: string) => firestore().collection('cards').doc(cardId).collection('activity'),
  attachments: (cardId: string) => firestore().collection('cards').doc(cardId).collection('attachments'),
  versions: (pageId: string) => firestore().collection('pages').doc(pageId).collection('versions'),
  threads: (pageId: string) => firestore().collection('pages').doc(pageId).collection('threads'),
  pageAttachments: (pageId: string) => firestore().collection('pages').doc(pageId).collection('attachments'),
};

// ---------------------------------------------------------------- projects

export async function allProjects(): Promise<Project[]> {
  return (await col.projects().get()).docs.map((d) => fromDoc<Project>(d));
}

export async function projectByKey(key: string): Promise<Project> {
  const snap = await col.projects().where('key', '==', key.trim().toUpperCase()).limit(1).get();
  if (snap.empty) throw notFound(`Project ${key} not found`);
  return fromDoc<Project>(snap.docs[0]);
}

export async function projectById(id: string): Promise<Project> {
  const snap = await col.projects().doc(id).get();
  if (!snap.exists) throw notFound(`Project ${id} not found`);
  return fromDoc<Project>(snap);
}

// ---------------------------------------------------------------- cards

/** Card response: the stored card plus `status` (column name), `statusId`, `project` (key) and `parent` (key). */
export type ApiCard = Omit<Card, 'status'> & { status: string; statusId: string; project: string; parent: string | null };

export function cardJson(card: Card, project: Project, keyOf: (id: string) => string | undefined): ApiCard {
  return {
    ...card,
    status: statusName(project.columns, card.status),
    statusId: card.status,
    project: project.key,
    parent: card.parentId ? (keyOf(card.parentId) ?? null) : null,
  };
}

export async function cardRefByKey(key: string): Promise<DocumentReference> {
  const normalized = normalizeCardKey(key);
  if (!normalized) throw notFound(`Card ${key} not found (keys look like NI-12)`);
  const snap = await col.cards().where('key', '==', normalized).limit(1).get();
  if (snap.empty) throw notFound(`Card ${normalized} not found`);
  return snap.docs[0].ref;
}

export async function cardByKey(key: string): Promise<Card> {
  return fromDoc<Card>(await (await cardRefByKey(key)).get());
}

export async function cardsOfProject(projectId: string): Promise<Card[]> {
  return (await col.cards().where('projectId', '==', projectId).get()).docs.map((d) => fromDoc<Card>(d));
}

/** A card's key by id (for `parent`), looked up when not in `known`. */
export async function keyResolver(ids: readonly (string | undefined)[], known: readonly Card[] = []) {
  const keys = new Map(known.map((c) => [c.id, c.key]));
  const missing = [...new Set(ids.filter((id): id is string => !!id && !keys.has(id)))];
  if (missing.length) {
    const snaps = await firestore().getAll(...missing.map((id) => col.cards().doc(id)));
    for (const s of snaps) if (s.exists) keys.set(s.id, s.get('key') as string);
  }
  return (id: string) => keys.get(id);
}

/** Serializes one card (looks up its project and parent key). */
export async function cardResponse(card: Card, project?: Project): Promise<ApiCard> {
  const p = project ?? (await projectById(card.projectId));
  return cardJson(card, p, await keyResolver([card.parentId]));
}

// ---------------------------------------------------------------- activity

interface Writer {
  set(ref: DocumentReference, data: Record<string, unknown>): unknown;
}

/** Adds activity entries for a card to the same batch/transaction as the change (like src/data/writes.ts). */
export function writeActivity(w: Writer, cardId: string, drafts: readonly ActivityDraft[], actor: Actor) {
  for (const draft of drafts) {
    const entry: Omit<Activity, 'id' | 'at'> & { at: FieldValue } = { ...draft, actor, at: FieldValue.serverTimestamp() };
    w.set(col.activity(cardId).doc(), entry);
  }
}

// ---------------------------------------------------------------- labels

/**
 * Resolves label names against the existing labels (case-insensitive; the existing
 * spelling wins) and queues creation of missing ones with the default color, like
 * the SPA's `ensureLabel`. Returns the canonical, de-duplicated names.
 */
export function ensureLabels(w: Writer, existing: Label[], names: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    let label = findLabel(existing, name);
    if (!label) {
      const ref = col.labels().doc();
      label = { id: ref.id, name, color: colorFor(name) };
      w.set(ref, { name: label.name, color: label.color });
      existing.push(label);
    }
    if (!out.includes(label.name)) out.push(label.name);
  }
  return out;
}

export function labelsFrom(snaps: readonly DocumentSnapshot[]): Label[] {
  return snaps.map((d) => fromDoc<Label>(d));
}

// ---------------------------------------------------------------- pages

export async function pageById(id: string): Promise<Page> {
  const snap = await col.pages().doc(id).get();
  if (!snap.exists) throw notFound(`Page ${id} not found`);
  return fromDoc<Page>(snap);
}

export async function allPages(): Promise<Page[]> {
  return (await col.pages().get()).docs.map((d) => fromDoc<Page>(d));
}

/** A version snapshot document (src/data/pages.ts `snapshot`). */
export function versionDoc(version: number, title: string, content: string, actor: Actor) {
  return { version, title, content, savedAt: FieldValue.serverTimestamp(), actor };
}
