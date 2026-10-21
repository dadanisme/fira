import { LIMITS } from '@shared/workspaces';

/**
 * Friendly messages for failed Storage uploads (card attachments, page images). The upload
 * functions (`uploadAttachment`, `uploadPageImage`) already reject files over
 * `LIMITS.fileBytes` before uploading; this turns that, and Storage's own rejections, into
 * something to show the user.
 */

const LIMIT_LABEL = `${LIMITS.fileBytes / (1024 * 1024)} MB`;

/** Whether `file` is over the per-file limit (storage rules reject it). */
export function isFileTooLarge(file: Pick<File, 'size'>): boolean {
  return file.size > LIMITS.fileBytes;
}

const MB = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

/** What to tell the user about a failed upload of `file`. */
export function uploadErrorMessage(err: unknown, file?: Pick<File, 'name' | 'size'>): string {
  const name = file?.name ? `“${file.name}”` : 'This file';
  if (file && isFileTooLarge(file)) return `${name} is ${MB(file.size)}; files are limited to ${LIMIT_LABEL}.`;
  const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
  // Storage rules: over the size limit, or not a member of this workspace (anymore).
  if (code === 'storage/unauthorized') return `${name} couldn't be uploaded: files are limited to ${LIMIT_LABEL}, and only members of this workspace can upload.`;
  if (code === 'storage/canceled') return `Upload of ${name} was canceled.`;
  if (code === 'storage/retry-limit-exceeded' || code === 'storage/unknown') return `${name} couldn't be uploaded. Check your connection and try again.`;
  const message = err instanceof Error ? err.message : String(err);
  return file?.name ? `${name} couldn't be uploaded: ${message}` : message;
}

/** `uploadErrorMessage` as an `Error`, for error toasts: `.catch((err) => toastError(uploadError(err, file)))`. */
export function uploadError(err: unknown, file?: Pick<File, 'name' | 'size'>): Error {
  return new Error(uploadErrorMessage(err, file), { cause: err });
}
