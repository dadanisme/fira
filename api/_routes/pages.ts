import { FieldValue as Fv, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { randomId } from '../../shared/ids.js';
import { restorePlan, trashIds, wouldCycle } from '../../shared/pages.js';
import { byRank, rankAfterLast } from '../../shared/rank.js';
import type { Actor, Page, PageVersion, Thread } from '../../shared/types.js';
import { firestore } from '../_lib/admin.js';
import { badRequest, created, jsonBody, notFound, unprocessable, versionConflict } from '../_lib/http.js';
import { paginate } from '../_lib/paginate.js';
import { route } from '../_lib/router.js';
import { fromDoc } from '../_lib/serialize.js';
import { allPages, col, pageById, versionDoc } from '../_lib/store.js';
import {
  onlyKeys,
  optBoolean,
  optInteger,
  optNullableString,
  optString,
  queryBool,
} from '../_lib/validate.js';

const MAX_TITLE = 500;
const MAX_ICON = 16;
const MAX_BODY = 50_000;

function optTitle(body: Record<string, unknown>): string | undefined {
  const title = optString(body, 'title');
  if (title !== undefined && title.length > MAX_TITLE) throw unprocessable(`title must be at most ${MAX_TITLE} characters`);
  return title;
}

function optIcon(body: Record<string, unknown>): string | null | undefined {
  const icon = optNullableString(body, 'icon');
  if (typeof icon === 'string' && (!icon.trim() || icon.length > MAX_ICON)) {
    throw unprocessable(`icon must be an emoji (1–${MAX_ICON} characters) or null`);
  }
  return icon;
}

function reqBody(body: Record<string, unknown>): string {
  const text = optString(body, 'body');
  if (text === undefined) throw badRequest('body (Markdown) is required');
  if (!text.trim()) throw unprocessable('body must not be empty');
  if (text.length > MAX_BODY) throw unprocessable(`body must be at most ${MAX_BODY} characters`);
  return text;
}

async function livePage(wid: string, id: string, what: string): Promise<Page> {
  const snap = await col.pages(wid).doc(id).get();
  if (!snap.exists) throw unprocessable(`${what} page ${id} not found`);
  const page = fromDoc<Page>(snap);
  if (page.trashed) throw unprocessable(`${what} page ${id} is in the trash`);
  return page;
}

// ---------------------------------------------------------------- pages

async function listPages(wid: string, query: URLSearchParams) {
  const parent = query.get('parent');
  const template = queryBool(query, 'template', undefined);
  const trashed = queryBool(query, 'trashed', false);
  const q = query.get('q')?.trim().toLowerCase();
  const pages = (await allPages(wid)).filter(
    (p) =>
      p.trashed === trashed &&
      (template === undefined || p.isTemplate === template) &&
      (parent === null || (parent === 'root' ? p.parentId === null : p.parentId === parent)) &&
      (!q || `${p.title}\n${p.content}`.toLowerCase().includes(q)),
  );
  return paginate(
    pages.sort((a, b) => byRank(a, b) || a.id.localeCompare(b.id)),
    query,
  );
}

async function createPage(wid: string, body: Record<string, unknown>, actor: Actor) {
  onlyKeys(body, ['title', 'parent', 'content', 'template', 'isTemplate', 'icon']);
  const templateId = optString(body, 'template');
  const template = templateId ? await livePage(wid, templateId, 'Template') : undefined;
  const title = optTitle(body) ?? template?.title;
  if (title === undefined) throw badRequest('title is required (or pass template to copy its title)');
  const parentId = optNullableString(body, 'parent') ?? null;
  if (parentId) await livePage(wid, parentId, 'Parent');
  const content = optString(body, 'content') ?? template?.content ?? '';
  const icon = optIcon(body) ?? template?.icon;
  const isTemplate = optBoolean(body, 'isTemplate') ?? false;

  const siblings = (await col.pages(wid).where('parentId', '==', parentId).get()).docs.map((d) => fromDoc<Page>(d));
  const ref = col.pages(wid).doc();
  const batch = firestore().batch();
  batch.set(ref, {
    title,
    icon: icon ?? undefined,
    parentId,
    rank: rankAfterLast(siblings),
    content,
    version: 1,
    isTemplate,
    trashed: false,
    createdAt: Fv.serverTimestamp(),
    updatedAt: Fv.serverTimestamp(),
    updatedBy: actor,
  });
  batch.set(col.versions(wid, ref.id).doc(), versionDoc(1, title, content, actor));
  await batch.commit();
  return created(fromDoc<Page>(await ref.get()));
}

async function patchPage(wid: string, id: string, body: Record<string, unknown>, actor: Actor) {
  onlyKeys(body, ['title', 'content', 'parent', 'icon', 'trashed', 'isTemplate', 'version']);
  const title = optTitle(body);
  const content = optString(body, 'content');
  const parent = optNullableString(body, 'parent');
  const icon = optIcon(body);
  const trashed = optBoolean(body, 'trashed');
  const isTemplate = optBoolean(body, 'isTemplate');
  const version = optInteger(body, 'version');
  const saves = title !== undefined || content !== undefined;
  if (saves && version === undefined) throw badRequest('version is required with title/content (the version your edit is based on)');
  const ref = col.pages(wid).doc(id);

  const conflictWith = await firestore().runTransaction(async (tx): Promise<Page | null> => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound(`Page ${id} not found`);
    const page = fromDoc<Page>(snap);
    const pages = parent !== undefined || trashed !== undefined ? (await tx.get(col.pages(wid))).docs.map((d) => fromDoc<Page>(d)) : [];
    if (saves && version !== page.version) return page;

    const updates = new Map<string, DocumentData>();
    const update = (pageId: string, data: DocumentData) => updates.set(pageId, { ...updates.get(pageId), ...data });

    if (trashed === true && !page.trashed) {
      const trashedAt = Timestamp.now();
      for (const pid of trashIds(pages, page.id)) update(pid, { trashed: true, trashedAt });
    } else if (trashed === false && page.trashed) {
      const plan = restorePlan(pages, page);
      for (const pid of plan.ids) update(pid, { trashed: false, trashedAt: Fv.delete() });
      if (plan.orphaned) update(page.id, { parentId: null });
    }
    if (parent !== undefined && parent !== page.parentId) {
      if (parent !== null) {
        const target = pages.find((p) => p.id === parent);
        if (!target) throw unprocessable(`Parent page ${parent} not found`);
        if (target.trashed) throw unprocessable(`Parent page ${parent} is in the trash`);
        if (wouldCycle(pages, page.id, parent)) throw unprocessable('A page cannot be moved under itself or its descendants');
      }
      const siblings = pages.filter((p) => p.parentId === parent && p.id !== page.id);
      update(page.id, { parentId: parent, rank: rankAfterLast(siblings) });
    }
    if (icon !== undefined) update(page.id, { icon: icon === null ? Fv.delete() : icon });
    if (isTemplate !== undefined) update(page.id, { isTemplate });
    if (saves) {
      // API saves always write a version snapshot (SPEC: pages/{id}/versions).
      const next = page.version + 1;
      const nextTitle = title ?? page.title;
      const nextContent = content ?? page.content;
      update(page.id, { title: nextTitle, content: nextContent, version: next, updatedAt: Fv.serverTimestamp(), updatedBy: actor });
      tx.set(col.versions(wid, page.id).doc(), versionDoc(next, nextTitle, nextContent, actor));
    }
    for (const [pid, data] of updates) tx.update(col.pages(wid).doc(pid), data);
    return null;
  });

  if (conflictWith) {
    throw versionConflict(`Page is at version ${conflictWith.version}; your edit is based on ${version}`, conflictWith);
  }
  return fromDoc<Page>(await ref.get());
}

// ---------------------------------------------------------------- threads

/** Messages live in an array where server timestamps are not allowed: stamped with server time (like the SPA). */
function message(body: string, author: Actor) {
  return { id: randomId(), body, author, createdAt: Timestamp.now() };
}

async function threadRef(wid: string, pageId: string, threadId: string) {
  await pageById(wid, pageId);
  const ref = col.threads(wid, pageId).doc(threadId);
  if (!(await ref.get()).exists) throw notFound(`Thread ${threadId} not found on page ${pageId}`);
  return ref;
}

export const pageRoutes = [
  route('GET', '/pages', 'token', async ({ query, workspaceId }) => listPages(workspaceId, query)),
  route('POST', '/pages', 'token', async ({ req, actor, workspaceId }) => createPage(workspaceId, jsonBody(req), actor)),
  route('GET', '/pages/:id', 'token', async ({ params, workspaceId }) => pageById(workspaceId, params.id)),
  route('PATCH', '/pages/:id', 'token', async ({ req, params, actor, workspaceId }) =>
    patchPage(workspaceId, params.id, jsonBody(req), actor),
  ),

  route('GET', '/pages/:id/versions', 'token', async ({ params, query, workspaceId: wid }) => {
    await pageById(wid, params.id);
    const snap = await col.versions(wid, params.id).orderBy('savedAt', 'desc').get();
    return paginate(
      snap.docs.map((d) => fromDoc<PageVersion>(d)),
      query,
    );
  }),

  route('GET', '/pages/:id/threads', 'token', async ({ params, query, workspaceId: wid }) => {
    await pageById(wid, params.id);
    const resolved = query.get('resolved') === 'all' ? undefined : queryBool(query, 'resolved', false);
    const threads = (await col.threads(wid, params.id).get()).docs
      .map((d) => fromDoc<Thread>(d))
      .filter((t) => resolved === undefined || t.resolved === resolved)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    return paginate(threads, query);
  }),

  route('POST', '/pages/:id/threads', 'token', async ({ req, params, actor, workspaceId: wid }) => {
    const body = jsonBody(req);
    onlyKeys(body, ['quote', 'prefix', 'suffix', 'body']);
    const quote = optString(body, 'quote');
    if (!quote?.trim()) throw badRequest('quote (the selected text) is required');
    const prefix = optString(body, 'prefix') ?? '';
    const suffix = optString(body, 'suffix') ?? '';
    const text = reqBody(body);
    await pageById(wid, params.id);
    const ref = col.threads(wid, params.id).doc();
    await ref.set({
      quote,
      prefix: prefix.slice(-32),
      suffix: suffix.slice(0, 32),
      resolved: false,
      messages: [message(text, actor)],
      createdAt: Fv.serverTimestamp(),
    });
    return created(fromDoc<Thread>(await ref.get()));
  }),

  route('POST', '/pages/:id/threads/:tid/messages', 'token', async ({ req, params, actor, workspaceId: wid }) => {
    const body = jsonBody(req);
    onlyKeys(body, ['body']);
    const text = reqBody(body);
    const ref = await threadRef(wid, params.id, params.tid);
    await ref.update({ messages: Fv.arrayUnion(message(text, actor)) });
    return created(fromDoc<Thread>(await ref.get()));
  }),

  route('PATCH', '/pages/:id/threads/:tid', 'token', async ({ req, params, workspaceId: wid }) => {
    const body = jsonBody(req);
    onlyKeys(body, ['resolved']);
    const resolved = optBoolean(body, 'resolved');
    if (resolved === undefined) throw badRequest('resolved (boolean) is required');
    const ref = await threadRef(wid, params.id, params.tid);
    await ref.update({ resolved, resolvedAt: resolved ? Fv.serverTimestamp() : Fv.delete() });
    return fromDoc<Thread>(await ref.get());
  }),
];
