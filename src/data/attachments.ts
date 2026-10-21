import { orderBy, query, serverTimestamp, writeBatch } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useMemo } from 'react';
import type { Attachment } from '@shared/types';
import { db, storage } from '../lib/firebase';
import { currentActor } from './actor';
import { LIMITS, cardAttachmentPath } from '@shared/workspaces';
import { attachmentsCol, newDocIn, rawDoc, type Stored } from './db';
import { useLiveQuery, type Live } from './live';
import { writeActivity } from './writes';
import { currentWorkspaceId, useWorkspaceId } from './workspace';

/** Attachments of a card, oldest first. */
export function useAttachments(cardId: string | undefined): Live<Attachment[]> {
  const wid = useWorkspaceId();
  const q = useMemo(() => (cardId ? query(attachmentsCol(cardId, wid), orderBy('createdAt')) : null), [cardId, wid]);
  return useLiveQuery(q);
}

/** Files are limited to 10 MB (storage rules); checked here first so the UI can show why. */
export const FILE_TOO_LARGE = 'Files are limited to 10 MB';

/**
 * Uploads a file to Storage, then records it with an `attachment` activity entry (to = file name).
 * Rejects with `FILE_TOO_LARGE` for files over 10 MB, before uploading.
 */
export async function uploadAttachment(cardId: string, file: File): Promise<void> {
  if (file.size > LIMITS.fileBytes) throw new Error(FILE_TOO_LARGE);
  const actor = currentActor();
  const wid = currentWorkspaceId();
  const ref = newDocIn(wid, 'cards', cardId, 'attachments');
  const storagePath = cardAttachmentPath(wid, cardId, ref.id, file.name);
  await uploadBytes(storageRef(storage, storagePath), file, { contentType: file.type || undefined });
  const attachment: Stored<Attachment, 'createdAt'> = {
    name: file.name,
    size: file.size,
    contentType: file.type || 'application/octet-stream',
    storagePath,
    uploadedBy: actor,
    createdAt: serverTimestamp(),
  };
  const batch = writeBatch(db);
  batch.set(ref, attachment);
  writeActivity(batch, cardId, [{ kind: 'attachment', to: file.name }], actor, wid);
  await batch.commit();
}

/** Deletes the record (logged as `attachment` from = file name), then the stored file. */
export async function deleteAttachment(cardId: string, attachment: Attachment): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(rawDoc('cards', cardId, 'attachments', attachment.id));
  writeActivity(batch, cardId, [{ kind: 'attachment', from: attachment.name, to: null }], currentActor());
  await batch.commit();
  await deleteObject(storageRef(storage, attachment.storagePath));
}

export function attachmentUrl(attachment: Attachment): Promise<string> {
  return getDownloadURL(storageRef(storage, attachment.storagePath));
}
