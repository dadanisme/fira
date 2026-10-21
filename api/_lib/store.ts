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

/**
 * Firestore access shared by the route modules. Document shapes match src/data exactly. All content
 * lives under `workspaces/{wid}`; every helper takes the workspace id (`ctx.workspaceId`) first.
 */

const wsRef = (wid: string) => firestore().collection('workspaces').doc(wid);

/** Every content collection takes the workspace id first: `col.cards(wid)` = `workspaces/{wid}/cards`. */
export const col = {
  workspaces: () => firestore().collection('workspaces'),
  members: (wid: string) => wsRef(wid).collection('members'),
  invites: (wid: string) => wsRef(wid).collection('invites'),
  slugs: () => firestore().collection('slugs'),
  tokens: () => firestore().collection('tokens'),
  projects: (wid: string) => wsRef(wid).collection('projects'),
  labels: (wid: string) => wsRef(wid).collection('labels'),
  cards: (wid: string) => wsRef(wid).collection('cards'),
  pages: (wid: string) => wsRef(wid).collection('pages'),
  comments: (wid: string, cardId: string) => wsRef(wid).collection('cards').doc(cardId).collection('comments'),
  activity: (wid: string, cardId: string) => wsRef(wid).collection('cards').doc(cardId).collection('activity'),
  attachments: (wid: string, cardId: string) => wsRef(wid).collection('cards').doc(cardId).collection('attachments'),
  versions: (wid: string, pageId: string) => wsRef(wid).collection('pages').doc(pageId).collection('versions'),
  threads: (wid: string, pageId: string) => wsRef(wid).collection('pages').doc(pageId).collection('threads'),
  pageAttachments: (wid: string, pageId: string) => wsRef(wid).collection('pages').doc(pageId).collection('attachments'),
};

// ---------------------------------------------------------------- projects

export async function allProjects(wid: string): Promise<Project[]> {
  return (await col.projects(wid).get()).docs.map((d) => fromDoc<Project>(d));
}

export async function projectByKey(wid: string, key: string): Promise<Project> {
  const snap = await col.projects(wid).where('key', '==', key.trim().toUpperCase()).limit(1).get();
  if (snap.empty) throw notFound(`Project ${key} not found`);
  return fromDoc<Project>(snap.docs[0]);
}

export async function projectById(wid: string, id: string): Promise<Project> {
  const snap = await col.projects(wid).doc(id).get();
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

export async function cardRefByKey(wid: string, key: string): Promise<DocumentReference> {
  const normalized = normalizeCardKey(key);
  if (!normalized) throw notFound(`Card ${key} not found (keys look like NI-12)`);
  const snap = await col.cards(wid).where('key', '==', normalized).limit(1).get();
  if (snap.empty) throw notFound(`Card ${normalized} not found`);
  return snap.docs[0].ref;
}

export async function cardByKey(wid: string, key: string): Promise<Card> {
  return fromDoc<Card>(await (await cardRefByKey(wid, key)).get());
}

export async function cardsOfProject(wid: string, projectId: string): Promise<Card[]> {
  return (await col.cards(wid).where('projectId', '==', projectId).get()).docs.map((d) => fromDoc<Card>(d));
}

/** A card's key by id (for `parent`), looked up when not in `known`. */
export async function keyResolver(wid: string, ids: readonly (string | undefined)[], known: readonly Card[] = []) {
  const keys = new Map(known.map((c) => [c.id, c.key]));
  const missing = [...new Set(ids.filter((id): id is string => !!id && !keys.has(id)))];
  if (missing.length) {
    const snaps = await firestore().getAll(...missing.map((id) => col.cards(wid).doc(id)));
    for (const s of snaps) if (s.exists) keys.set(s.id, s.get('key') as string);
  }
  return (id: string) => keys.get(id);
}

/** Serializes one card (looks up its project and parent key). */
export async function cardResponse(wid: string, card: Card, project?: Project): Promise<ApiCard> {
  const p = project ?? (await projectById(wid, card.projectId));
  return cardJson(card, p, await keyResolver(wid, [card.parentId]));
}

// ---------------------------------------------------------------- activity

interface Writer {
  set(ref: DocumentReference, data: Record<string, unknown>): unknown;
}

/** Adds activity entries for a card to the same batch/transaction as the change (like src/data/writes.ts). */
export function writeActivity(w: Writer, wid: string, cardId: string, drafts: readonly ActivityDraft[], actor: Actor) {
  for (const draft of drafts) {
    const entry: Omit<Activity, 'id' | 'at'> & { at: FieldValue } = { ...draft, actor, at: FieldValue.serverTimestamp() };
    w.set(col.activity(wid, cardId).doc(), entry);
  }
}

// ---------------------------------------------------------------- labels

/**
 * Resolves label names against the existing labels (case-insensitive; the existing
 * spelling wins) and queues creation of missing ones with the default color, like
 * the SPA's `ensureLabel`. Returns the canonical, de-duplicated names.
 */
export function ensureLabels(w: Writer, wid: string, existing: Label[], names: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    let label = findLabel(existing, name);
    if (!label) {
      const ref = col.labels(wid).doc();
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

export async function pageById(wid: string, id: string): Promise<Page> {
  const snap = await col.pages(wid).doc(id).get();
  if (!snap.exists) throw notFound(`Page ${id} not found`);
  return fromDoc<Page>(snap);
}

export async function allPages(wid: string): Promise<Page[]> {
  return (await col.pages(wid).get()).docs.map((d) => fromDoc<Page>(d));
}

/** A version snapshot document (src/data/pages.ts `snapshot`). */
export function versionDoc(version: number, title: string, content: string, actor: Actor) {
  return { version, title, content, savedAt: FieldValue.serverTimestamp(), actor };
}
