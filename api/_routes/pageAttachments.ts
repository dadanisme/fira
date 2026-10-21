import { FieldValue as Fv } from 'firebase-admin/firestore';
import type { PageAttachment } from '../../shared/types.js';
import { bucket } from '../_lib/admin.js';
import { created, noContent, notFound } from '../_lib/http.js';
import { paginate } from '../_lib/paginate.js';
import { route } from '../_lib/router.js';
import { fromDoc } from '../_lib/serialize.js';
import { col, pageById } from '../_lib/store.js';
import { storeUpload } from '../_lib/uploads.js';
import { pageAttachmentPath } from '../../shared/workspaces.js';

/**
 * Files stored with a page (`workspaces/{wid}/pages/{pageId}/{attachmentId}/{name}` in Storage, metadata in
 * `workspaces/{wid}/pages/{id}/attachments`), each with a non-expiring download-token URL for `![alt](url)`.
 * Uploads are immutable: the same name again is a new attachment with a new URL. Any page
 * that exists accepts uploads, trashed or not.
 */
export const pageAttachmentRoutes = [
  route('GET', '/pages/:id/attachments', 'token', async ({ params, query, workspaceId: wid }) => {
    await pageById(wid, params.id);
    const snap = await col.pageAttachments(wid, params.id).orderBy('createdAt').get();
    return paginate(
      snap.docs.map((d) => fromDoc<PageAttachment>(d)),
      query,
    );
  }),

  route('POST', '/pages/:id/attachments', 'token', async ({ req, params, actor, workspaceId: wid }) => {
    const page = await pageById(wid, params.id);
    const ref = col.pageAttachments(wid, page.id).doc();
    const file = await storeUpload(req, (name) => pageAttachmentPath(wid, page.id, ref.id, name), { downloadToken: true });
    await ref.set({ ...file, uploadedBy: actor, createdAt: Fv.serverTimestamp() });
    return created(fromDoc<PageAttachment>(await ref.get()));
  }),

  route('DELETE', '/pages/:id/attachments/:aid', 'token', async ({ params, workspaceId: wid }) => {
    await pageById(wid, params.id);
    const ref = col.pageAttachments(wid, params.id).doc(params.aid);
    const snap = await ref.get();
    if (!snap.exists) throw notFound(`Attachment ${params.aid} not found on page ${params.id}`);
    const attachment = fromDoc<PageAttachment>(snap);
    await bucket().file(attachment.storagePath).delete({ ignoreNotFound: true });
    await ref.delete();
    return noContent();
  }),
];
