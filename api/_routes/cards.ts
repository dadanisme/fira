import { FieldValue as Fv, type DocumentData } from 'firebase-admin/firestore';
import type { CardPatch } from '../../shared/activity.js';
import { cardPatchActivity } from '../../shared/activity.js';
import { coerceFieldValue, fieldMatches } from '../../shared/fields.js';
import { formatCardKey, normalizeCardKey } from '../../shared/keys.js';
import { findLabel } from '../../shared/labels.js';
import { compareRank, rankAfterLast } from '../../shared/rank.js';
import { resolveStatus } from '../../shared/status.js';
import {
  CARD_TYPES,
  PRIORITIES,
  type Card,
  type CardType,
  type Column,
  type FieldValue,
  type Project,
} from '../../shared/types.js';
import { firestore } from '../_lib/admin.js';
import { badRequest, created, jsonBody, notFound, unprocessable, versionConflict } from '../_lib/http.js';
import { paginate } from '../_lib/paginate.js';
import { route } from '../_lib/router.js';
import { fromDoc } from '../_lib/serialize.js';
import {
  allProjects,
  cardJson,
  cardRefByKey,
  cardResponse,
  cardsOfProject,
  col,
  ensureLabels,
  keyResolver,
  labelsFrom,
  projectById,
  projectByKey,
  writeActivity,
} from '../_lib/store.js';
import {
  onlyKeys,
  optBoolean,
  optDate,
  optEnum,
  optInteger,
  optNullableString,
  optObject,
  optString,
  optStringArray,
  optText,
  queryBool,
  queryList,
  reqText,
} from '../_lib/validate.js';
import { assertLiveWorkspace } from '../_lib/workspaces.js';

const MAX_TITLE = 500;
const SORTS = ['created', '-created', 'updated', '-updated', 'rank'] as const;

// ---------------------------------------------------------------- validation helpers

function columnFor(project: Project, idOrName: string): Column {
  const column = resolveStatus(project.columns, idOrName);
  if (!column) {
    const names = project.columns.map((c) => c.name);
    throw unprocessable(`Unknown status "${idOrName}" for project ${project.key}. Valid: ${names.join(', ')}`, {
      validStatuses: names,
    });
  }
  return column;
}

/** Validates `fields` against the project's FieldDefs. `null` (remove) only when `allowNull`. */
function coerceFields(project: Project, input: Record<string, unknown>, allowNull: boolean): Record<string, FieldValue | null> {
  const out: Record<string, FieldValue | null> = {};
  for (const [key, value] of Object.entries(input)) {
    const def = project.fields.find((f) => f.key === key);
    if (!def) {
      const keys = project.fields.map((f) => `${f.key} (${f.type})`);
      throw unprocessable(`Unknown field "${key}" for project ${project.key}. Valid: ${keys.join(', ') || 'none defined'}`);
    }
    if (value === null) {
      if (!allowNull) throw unprocessable(`fields.${key} must not be null`);
      out[key] = null;
      continue;
    }
    const coerced = coerceFieldValue(def, value);
    if (!coerced.ok) throw unprocessable(`fields.${coerced.error}`);
    out[key] = coerced.value;
  }
  return out;
}

/** Enforces the hierarchy: epics have no parent, a card's parent is an epic, a subtask's parent is a card. */
function checkParent(type: CardType, parent: Card | null, project: Project, selfId?: string) {
  if (type === 'epic' && parent) throw unprocessable('An epic cannot have a parent');
  if (type === 'subtask' && !parent) throw unprocessable('A subtask needs a parent card');
  if (!parent) return;
  if (parent.id === selfId) throw unprocessable('A card cannot be its own parent');
  if (parent.projectId !== project.id) throw unprocessable(`Parent ${parent.key} is in another project`);
  if (type === 'card' && parent.type !== 'epic') throw unprocessable(`The parent of a card must be an epic (${parent.key} is a ${parent.type})`);
  if (type === 'subtask' && parent.type !== 'card') throw unprocessable(`The parent of a subtask must be a card (${parent.key} is a ${parent.type})`);
}

async function parentByKey(wid: string, key: string): Promise<Card> {
  const normalized = normalizeCardKey(key);
  if (!normalized) throw unprocessable(`parent must be a card key like NI-12`);
  const snap = await col.cards(wid).where('key', '==', normalized).limit(1).get();
  if (snap.empty) throw unprocessable(`Parent card ${normalized} not found`);
  return fromDoc<Card>(snap.docs[0]);
}

function sameLabel(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// ---------------------------------------------------------------- search

function sortCards(cards: Card[], sort: (typeof SORTS)[number], projects: Map<string, Project>) {
  const columnIndex = (c: Card) => projects.get(c.projectId)?.columns.findIndex((col) => col.id === c.status) ?? -1;
  const projectRank = (c: Card) => projects.get(c.projectId)?.rank ?? '';
  const cmp: Record<typeof sort, (a: Card, b: Card) => number> = {
    created: (a, b) => a.createdAt.localeCompare(b.createdAt),
    '-created': (a, b) => b.createdAt.localeCompare(a.createdAt),
    updated: (a, b) => a.updatedAt.localeCompare(b.updatedAt),
    '-updated': (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    // Board order: project, column, rank.
    rank: (a, b) =>
      compareRank(projectRank(a), projectRank(b)) || columnIndex(a) - columnIndex(b) || compareRank(a.rank, b.rank),
  };
  // Ties: project then card number, so pagination is stable.
  return cards.sort((a, b) => cmp[sort](a, b) || a.projectId.localeCompare(b.projectId) || a.number - b.number);
}

async function searchCards(wid: string, query: URLSearchParams) {
  const projectKey = query.get('project');
  const projects = projectKey ? [await projectByKey(wid, projectKey)] : await allProjects(wid);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const cards = projectKey ? await cardsOfProject(wid, projects[0].id) : (await col.cards(wid).get()).docs.map((d) => fromDoc<Card>(d));

  const statuses = queryList(query, 'status');
  if (projectKey) statuses.forEach((s) => columnFor(projects[0], s)); // 422 on unknown names
  const labels = queryList(query, 'label');
  const type = query.get('type');
  if (type && !CARD_TYPES.includes(type as CardType)) throw unprocessable(`type must be one of: ${CARD_TYPES.join(', ')}`);
  const priority = query.get('priority');
  if (priority && !PRIORITIES.includes(priority as Card['priority'])) {
    throw unprocessable(`priority must be one of: ${PRIORITIES.join(', ')}`);
  }
  const parentParam = query.get('parent');
  let parentId: string | undefined;
  if (parentParam) {
    const key = normalizeCardKey(parentParam);
    if (!key) throw unprocessable('parent must be a card key like NI-12');
    parentId = cards.find((c) => c.key === key)?.id ?? (await col.cards(wid).where('key', '==', key).limit(1).get()).docs[0]?.id ?? '';
  }
  const q = query.get('q')?.trim().toLowerCase();
  const archivedParam = query.get('archived');
  const archived = archivedParam === 'all' ? undefined : queryBool(query, 'archived', false);
  const sortParam = query.get('sort') ?? 'rank';
  if (!SORTS.includes(sortParam as (typeof SORTS)[number])) throw badRequest(`sort must be one of: ${SORTS.join(', ')}`);

  const fieldFilters = [...new Set([...query.keys()].filter((k) => k.startsWith('field.')))].map((k) => ({
    key: k.slice('field.'.length),
    values: query.getAll(k),
  }));
  if (projectKey) {
    for (const f of fieldFilters) {
      if (!projects[0].fields.some((d) => d.key === f.key)) throw unprocessable(`Unknown field "${f.key}" for project ${projects[0].key}`);
    }
  }

  const matches = cards.filter((card) => {
    const project = byId.get(card.projectId);
    if (!project) return false;
    if (archived !== undefined && card.archived !== archived) return false;
    if (statuses.length) {
      const ok = statuses.some((s) => resolveStatus(project.columns, s)?.id === card.status);
      if (!ok) return false;
    }
    if (labels.length && !labels.some((l) => card.labels.some((cl) => sameLabel(cl, l)))) return false;
    if (type && card.type !== type) return false;
    if (priority && card.priority !== priority) return false;
    if (parentId !== undefined && card.parentId !== parentId) return false;
    if (q && !`${card.title}\n${card.description}`.toLowerCase().includes(q)) return false;
    for (const f of fieldFilters) {
      const def = project.fields.find((d) => d.key === f.key);
      if (!f.values.some((v) => fieldMatches(def, card.fields[f.key], v))) return false;
    }
    return true;
  });

  const page = paginate(sortCards(matches, sortParam as (typeof SORTS)[number], byId), query);
  const keyOf = await keyResolver(
    wid,
    page.items.map((c) => c.parentId),
    cards,
  );
  return { ...page, items: page.items.map((c) => cardJson(c, byId.get(c.projectId)!, keyOf)) };
}

// ---------------------------------------------------------------- create

const CREATE_KEYS = ['project', 'title', 'description', 'status', 'type', 'parent', 'priority', 'labels', 'dueDate', 'fields'];

async function createCard(wid: string, body: Record<string, unknown>, actor: Card['createdBy']) {
  onlyKeys(body, CREATE_KEYS);
  const projectKey = optString(body, 'project');
  if (!projectKey) throw badRequest('project (key) is required');
  const project = await projectByKey(wid, projectKey);
  const title = reqText(body, 'title', MAX_TITLE);
  const description = optString(body, 'description') ?? '';
  const statusParam = optString(body, 'status');
  const column = statusParam !== undefined ? columnFor(project, statusParam) : project.columns[0];
  if (!column) throw unprocessable(`Project ${project.key} has no columns`);
  const type = optEnum(body, 'type', CARD_TYPES) ?? 'card';
  const parentKey = optNullableString(body, 'parent');
  const parent = parentKey ? await parentByKey(wid, parentKey) : null;
  checkParent(type, parent, project);
  const priority = optEnum(body, 'priority', PRIORITIES) ?? 'none';
  const labelNames = optStringArray(body, 'labels') ?? [];
  const dueDate = optDate(body, 'dueDate') ?? undefined;
  const fieldsInput = optObject(body, 'fields');
  const fields = (fieldsInput ? coerceFields(project, fieldsInput, false) : {}) as Record<string, FieldValue>;

  const ref = col.cards(wid).doc();
  const projectRef = col.projects(wid).doc(project.id);

  await firestore().runTransaction(async (tx) => {
    // One getAll: parallel first reads can race the transaction's begin under contention.
    const [ws, snap] = await tx.getAll(col.workspaces().doc(wid), projectRef);
    assertLiveWorkspace(ws);
    if (!snap.exists) throw notFound(`Project ${project.key} not found`);
    const existingLabels = labelsFrom((await tx.get(col.labels(wid))).docs);
    // Read after the project lock, so concurrent creates in the same column get distinct ranks.
    const siblings = (await tx.get(col.cards(wid).where('projectId', '==', project.id))).docs
      .map((d) => fromDoc<Card>(d))
      .filter((c) => c.status === column.id);
    const rank = rankAfterLast(siblings);
    const number = snap.get('nextNumber') as number;
    const labels = ensureLabels(tx, wid, existingLabels, labelNames);
    const card: Omit<Card, 'id' | 'createdAt' | 'updatedAt'> & { createdAt: Fv; updatedAt: Fv } = {
      projectId: project.id,
      key: formatCardKey(project.key, number),
      number,
      type,
      parentId: parent?.id,
      title,
      description,
      descriptionVersion: 1,
      status: column.id,
      rank,
      priority,
      labels,
      dueDate,
      fields,
      archived: false,
      createdAt: Fv.serverTimestamp(),
      updatedAt: Fv.serverTimestamp(),
      createdBy: actor,
      updatedBy: actor,
    };
    tx.set(ref, card);
    tx.update(projectRef, { nextNumber: number + 1 });
    writeActivity(tx, wid, ref.id, [{ kind: 'created' }], actor);
  });
  return created(await cardResponse(wid, fromDoc<Card>(await ref.get()), project));
}

// ---------------------------------------------------------------- update

const PATCH_KEYS = [
  'title',
  'status',
  'priority',
  'dueDate',
  'parent',
  'fields',
  'labels',
  'addLabels',
  'removeLabels',
  'archived',
  'description',
  'descriptionVersion',
];

async function patchCard(wid: string, key: string, body: Record<string, unknown>, actor: Card['updatedBy']) {
  onlyKeys(body, PATCH_KEYS);
  const ref = await cardRefByKey(wid, key);
  const before = fromDoc<Card>(await ref.get());
  const project = await projectById(wid, before.projectId);

  const title = optText(body, 'title', MAX_TITLE);
  const statusParam = optString(body, 'status');
  const column = statusParam !== undefined ? columnFor(project, statusParam) : undefined;
  const priority = optEnum(body, 'priority', PRIORITIES);
  const dueDate = optDate(body, 'dueDate');
  const parentKey = optNullableString(body, 'parent');
  let parent: Card | null | undefined;
  if (parentKey !== undefined) {
    parent = parentKey === null ? null : await parentByKey(wid, parentKey);
    checkParent(before.type, parent, project, before.id);
  }
  const fieldsInput = optObject(body, 'fields');
  const fields = fieldsInput ? coerceFields(project, fieldsInput, true) : undefined;
  const labels = optStringArray(body, 'labels');
  const addLabels = optStringArray(body, 'addLabels');
  const removeLabels = optStringArray(body, 'removeLabels');
  const archived = optBoolean(body, 'archived');
  const description = optString(body, 'description');
  const descriptionVersion = optInteger(body, 'descriptionVersion');
  if (description !== undefined && descriptionVersion === undefined) {
    throw badRequest('descriptionVersion is required with description (the version your edit is based on)');
  }

  // A status change appends the card to the end of the target column.
  const rank =
    column && column.id !== before.status
      ? rankAfterLast((await cardsOfProject(wid, project.id)).filter((c) => c.status === column.id && c.id !== before.id))
      : undefined;
  const keyOf = await keyResolver(wid, [before.parentId]);

  const result = await firestore().runTransaction(async (tx): Promise<{ conflict?: Card; card: Card | null }> => {
    const card = fromDoc<Card>(await tx.get(ref));
    const touchesLabels = labels !== undefined || addLabels !== undefined || removeLabels !== undefined;
    const existingLabels = touchesLabels ? labelsFrom((await tx.get(col.labels(wid))).docs) : [];
    if (description !== undefined && descriptionVersion !== card.descriptionVersion) return { conflict: card, card: null };

    const patch: CardPatch = {};
    if (title !== undefined) patch.title = title;
    if (column && column.id !== card.status) {
      patch.status = column.id;
      patch.rank = rank;
    }
    if (priority !== undefined) patch.priority = priority;
    if (dueDate !== undefined) patch.dueDate = dueDate;
    if (parent !== undefined) patch.parentId = parent?.id ?? null;
    if (fields !== undefined) patch.fields = fields;
    if (archived !== undefined) patch.archived = archived;
    if (description !== undefined) patch.description = description;
    if (touchesLabels) {
      let next = [...(labels ?? card.labels), ...(addLabels ?? [])];
      if (removeLabels) next = next.filter((l) => !removeLabels.some((r) => sameLabel(l, r)));
      // Keep the card's own spelling for labels it already has; canonicalize/create the rest.
      const kept = next.map((l) => card.labels.find((cl) => sameLabel(cl, l)) ?? findLabel(existingLabels, l)?.name ?? l);
      patch.labels = ensureLabels(tx, wid, existingLabels, kept);
    }

    const drafts = cardPatchActivity(card, patch, {
      columns: project.columns,
      cardKey: (id) => (id === parent?.id ? parent.key : keyOf(id)),
    });
    if (drafts.length === 0) return { card };

    const data: DocumentData = { updatedAt: Fv.serverTimestamp(), updatedBy: actor };
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'fields') {
        for (const [field, value] of Object.entries(v as NonNullable<CardPatch['fields']>)) {
          data[`fields.${field}`] = value === null ? Fv.delete() : value;
        }
      } else if (v !== undefined) {
        data[k] = v === null ? Fv.delete() : v;
      }
    }
    if (patch.description !== undefined && patch.description !== card.description) {
      data.descriptionVersion = card.descriptionVersion + 1;
    }
    tx.update(ref, data);
    writeActivity(tx, wid, card.id, drafts, actor);
    return { card: null };
  });

  if (result.conflict) {
    throw versionConflict(
      `Description is at version ${result.conflict.descriptionVersion}; your edit is based on ${descriptionVersion}`,
      await cardResponse(wid, result.conflict, project),
    );
  }
  return cardResponse(wid, result.card ?? fromDoc<Card>(await ref.get()), project);
}

// ---------------------------------------------------------------- routes

export const cardRoutes = [
  route('GET', '/cards', 'token', async ({ query, workspaceId }) => searchCards(workspaceId, query)),
  route('POST', '/cards', 'token', async ({ req, actor, workspaceId }) => createCard(workspaceId, jsonBody(req), actor)),
  route('GET', '/cards/:key', 'token', async ({ params, workspaceId }) => {
    const ref = await cardRefByKey(workspaceId, params.key);
    return cardResponse(workspaceId, fromDoc<Card>(await ref.get()));
  }),
  route('PATCH', '/cards/:key', 'token', async ({ req, params, actor, workspaceId }) =>
    patchCard(workspaceId, params.key, jsonBody(req), actor),
  ),
];
