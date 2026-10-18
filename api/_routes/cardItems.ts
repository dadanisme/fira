import { FieldValue as Fv, Timestamp } from 'firebase-admin/firestore';
import { cardPatchActivity } from '../../shared/activity.js';
import { workPageTitle } from '../../shared/pages.js';
import { rankAfterLast } from '../../shared/rank.js';
import { ACTIVITY_KINDS, type Activity, type ActivityKind, type Attachment, type Card, type Comment, type Page } from '../../shared/types.js';
import { bucket, firestore } from '../_lib/admin.js';
import { badRequest, conflict, created, jsonBody, noContent, notFound, unprocessable } from '../_lib/http.js';
import { readFile } from '../_lib/multipart.js';
import { paginate } from '../_lib/paginate.js';
import { route } from '../_lib/router.js';
import { fromDoc } from '../_lib/serialize.js';
import { cardRefByKey, cardResponse, col, projectById, versionDoc, writeActivity } from '../_lib/store.js';
import { onlyKeys, optString, queryList } from '../_lib/validate.js';

const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const URL_TTL_MS = 60 * 60 * 1000;
const MAX_COMMENT = 50_000;

async function cardOf(key: string): Promise<Card> {
  return fromDoc<Card>(await (await cardRefByKey(key)).get());
}

/** Attachment with a signed download URL valid for one hour. */
async function withUrl(attachment: Attachment) {
  const expires = Date.now() + URL_TTL_MS;
  const [url] = await bucket().file(attachment.storagePath).getSignedUrl({ action: 'read', expires });
  return { ...attachment, url, urlExpiresAt: new Date(expires).toISOString() };
}

/** Storage object names may not contain path separators from the client file name. */
function safeName(name: string): string {
  const cleaned = [...name.replace(/[/\\]/g, '_')].filter((ch) => ch.charCodeAt(0) >= 32).join('').trim();
  return cleaned.slice(-200) || 'file';
}

export const cardItemRoutes = [
  // ------------------------------------------------------------ activity
  route('GET', '/cards/:key/activity', 'token', async ({ params, query }) => {
    const card = await cardOf(params.key);
    const kinds = queryList(query, 'kind', true);
    const bad = kinds.filter((k) => !ACTIVITY_KINDS.includes(k as ActivityKind));
    if (bad.length) throw unprocessable(`Unknown kind(s): ${bad.join(', ')}. Valid: ${ACTIVITY_KINDS.join(', ')}`);
    const sinceParam = query.get('since');
    let since: Timestamp | undefined;
    if (sinceParam) {
      const ms = Date.parse(sinceParam);
      if (Number.isNaN(ms)) throw badRequest('since must be an ISO 8601 timestamp');
      since = Timestamp.fromMillis(ms);
    }
    let q = col.activity(card.id).orderBy('at');
    if (since) q = q.where('at', '>', since);
    const entries = (await q.get()).docs.map((d) => fromDoc<Activity>(d)).filter((a) => !kinds.length || kinds.includes(a.kind));
    return paginate(entries, query);
  }),

  // ------------------------------------------------------------ comments
  route('GET', '/cards/:key/comments', 'token', async ({ params, query }) => {
    const card = await cardOf(params.key);
    const snap = await col.comments(card.id).orderBy('createdAt').get();
    return paginate(
      snap.docs.map((d) => fromDoc<Comment>(d)),
      query,
    );
  }),

  route('POST', '/cards/:key/comments', 'token', async ({ req, params, actor }) => {
    const body = jsonBody(req);
    onlyKeys(body, ['body']);
    const text = optString(body, 'body');
    if (text === undefined) throw badRequest('body (Markdown) is required');
    if (!text.trim()) throw unprocessable('body must not be empty');
    if (text.length > MAX_COMMENT) throw unprocessable(`body must be at most ${MAX_COMMENT} characters`);
    const card = await cardOf(params.key);
    const ref = col.comments(card.id).doc();
    const batch = firestore().batch();
    batch.set(ref, { body: text, author: actor, createdAt: Fv.serverTimestamp() });
    writeActivity(batch, card.id, [{ kind: 'comment', to: ref.id }], actor);
    await batch.commit();
    return created(fromDoc<Comment>(await ref.get()));
  }),

  // ------------------------------------------------------------ attachments
  route('GET', '/cards/:key/attachments', 'token', async ({ params, query }) => {
    const card = await cardOf(params.key);
    const snap = await col.attachments(card.id).orderBy('createdAt').get();
    const page = paginate(
      snap.docs.map((d) => fromDoc<Attachment>(d)),
      query,
    );
    return { ...page, items: await Promise.all(page.items.map(withUrl)) };
  }),

  route('POST', '/cards/:key/attachments', 'token', async ({ req, params, actor }) => {
    const card = await cardOf(params.key);
    const file = await readFile(req, 'file', MAX_ATTACHMENT_BYTES);
    const name = safeName(file.name);
    const ref = col.attachments(card.id).doc();
    const storagePath = `attachments/${card.id}/${ref.id}/${name}`;
    await bucket().file(storagePath).save(file.data, { contentType: file.contentType, resumable: false });
    const batch = firestore().batch();
    batch.set(ref, {
      name,
      size: file.data.length,
      contentType: file.contentType,
      storagePath,
      uploadedBy: actor,
      createdAt: Fv.serverTimestamp(),
    });
    writeActivity(batch, card.id, [{ kind: 'attachment', to: name }], actor);
    await batch.commit();
    return created(await withUrl(fromDoc<Attachment>(await ref.get())));
  }),

  route('DELETE', '/cards/:key/attachments/:id', 'token', async ({ params, actor }) => {
    const card = await cardOf(params.key);
    const ref = col.attachments(card.id).doc(params.id);
    const snap = await ref.get();
    if (!snap.exists) throw notFound(`Attachment ${params.id} not found on ${card.key}`);
    const attachment = fromDoc<Attachment>(snap);
    const batch = firestore().batch();
    batch.delete(ref);
    writeActivity(batch, card.id, [{ kind: 'attachment', from: attachment.name, to: null }], actor);
    await batch.commit();
    await bucket().file(attachment.storagePath).delete({ ignoreNotFound: true });
    return noContent();
  }),

  // ------------------------------------------------------------ work page
  route('POST', '/cards/:key/page', 'token', async ({ req, params, actor }) => {
    const body = jsonBody(req);
    onlyKeys(body, ['template']);
    const templateParam = optString(body, 'template');
    const cardRef = await cardRefByKey(params.key);
    const before = fromDoc<Card>(await cardRef.get());
    if (before.pageId) throw conflict(`${before.key} already has a work page (${before.pageId})`);
    const project = await projectById(before.projectId);

    const templateId = templateParam ?? project.pageTemplateId;
    let template: Page | undefined;
    if (templateId) {
      const snap = await col.pages().doc(templateId).get();
      if (!snap.exists || snap.get('trashed') === true) {
        if (templateParam) throw unprocessable(`Template page ${templateParam} not found`);
      } else template = fromDoc<Page>(snap);
    }
    let parentId: string | null = null;
    if (project.pageParentId) {
      const snap = await col.pages().doc(project.pageParentId).get();
      if (snap.exists && snap.get('trashed') !== true) parentId = snap.id;
    }
    const siblings = (await col.pages().where('parentId', '==', parentId).get()).docs.map((d) => fromDoc<Page>(d));
    const pageRef = col.pages().doc();

    const title = workPageTitle(before);
    const content = template?.content ?? '';
    const result = await firestore().runTransaction(async (tx) => {
      const card = fromDoc<Card>(await tx.get(cardRef));
      if (card.pageId) return card;
      tx.set(pageRef, {
        title,
        icon: template?.icon,
        parentId,
        rank: rankAfterLast(siblings),
        content,
        version: 1,
        isTemplate: false,
        cardId: card.id,
        trashed: false,
        createdAt: Fv.serverTimestamp(),
        updatedAt: Fv.serverTimestamp(),
        updatedBy: actor,
      });
      tx.set(col.versions(pageRef.id).doc(), versionDoc(1, title, content, actor));
      tx.update(cardRef, { pageId: pageRef.id, updatedAt: Fv.serverTimestamp(), updatedBy: actor });
      writeActivity(tx, card.id, cardPatchActivity(card, { pageId: pageRef.id }, { columns: project.columns }), actor);
      return null;
    });
    if (result) throw conflict(`${result.key} already has a work page (${result.pageId})`);

    return created({
      page: fromDoc<Page>(await pageRef.get()),
      card: await cardResponse(fromDoc<Card>(await cardRef.get()), project),
    });
  }),
];
