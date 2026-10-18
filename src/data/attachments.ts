import { orderBy, query, serverTimestamp, writeBatch } from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { useMemo } from 'react';
import type { Attachment } from '@shared/types';
import { db, storage } from '../lib/firebase';
import { currentActor } from './actor';
import { attachmentsCol, newDoc, rawDoc, type Stored } from './db';
import { useLiveQuery, type Live } from './live';
import { writeActivity } from './writes';

/** Attachments of a card, oldest first. */
export function useAttachments(cardId: string | undefined): Live<Attachment[]> {
  const q = useMemo(() => (cardId ? query(attachmentsCol(cardId), orderBy('createdAt')) : null), [cardId]);
  return useLiveQuery(q);
}

/** Uploads a file to Storage, then records it with an `attachment` activity entry (to = file name). */
export async function uploadAttachment(cardId: string, file: File): Promise<void> {
  const actor = currentActor();
  const ref = newDoc('cards', cardId, 'attachments');
  const storagePath = `attachments/${cardId}/${ref.id}/${file.name}`;
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
  writeActivity(batch, cardId, [{ kind: 'attachment', to: file.name }], actor);
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
