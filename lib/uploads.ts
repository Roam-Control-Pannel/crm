/**
 * UPLOAD-POLICY-V1
 *
 * Single source of truth for what may enter the `roam-uploads` blob store
 * and what /api/images/[id] is allowed to serve back out of it.
 *
 * Why this lives in one module: /api/images/upload already had a size cap,
 * a MIME allowlist, an extension allowlist and a sharp transcode, while
 * /api/brain/items (the other writer into the same store) had none of them
 * and persisted the caller-supplied `file.type` verbatim. Because
 * /api/images/[id] echoes the stored contentType back as the response
 * Content-Type, and middleware serves that path without a session, the gap
 * let an uploaded `brief.html` be served as text/html on the app's own
 * origin. Keeping the policy in one place is what stops the two writers
 * drifting apart again.
 */

/**
 * 10 MB ceiling — large enough for high-res photos and ordinary PDFs, small
 * enough that a runaway client can't fill the blob store.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Raster formats sharp can decode and re-encode to JPEG. */
export const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
export const ALLOWED_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif']);

/**
 * Non-image documents the Brain accepts (see the `accept` attribute on the
 * Brain upload input). Deliberately excludes SVG, which is an image to a
 * browser but a script host in practice.
 */
export const ALLOWED_DOC_EXTS = new Set(['pdf', 'md', 'markdown', 'txt']);

/**
 * The only Content-Type values /api/images/[id] will ever put on a response.
 * Anything stored with a type outside this set — including everything
 * written before UPLOAD-POLICY-V1 landed — is served as an opaque download
 * instead of being rendered.
 */
export const SERVABLE_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/markdown',
  'text/plain',
]);

/** JPEG quality for transcoded uploads — the "good enough for social" point. */
export const JPEG_QUALITY = 85;

/**
 * Shape of every blob key this app generates:
 *   img_<epoch-ms>_<base36>.<ext>   (image + document uploads)
 *   txt_<epoch-ms>_<base36>.md      (Roam-io / Brain text saves)
 *
 * /api/images/[id] matches the incoming segment against this before it
 * touches the store. That is the guard that stops `..%2F…` traversal: the
 * Netlify Blobs client interpolates the key straight into the request path
 * and only validates keys on write, so a key containing `..` is normalised
 * by `new URL()` and walks out of roam-uploads into any sibling store —
 * including roam-tokens, which holds the LinkedIn and Meta credentials.
 */
const BLOB_ID_PATTERN = /^(?:img|txt)_\d{10,}_[a-z0-9]{1,16}\.[a-z0-9]{1,8}$/;

export function isValidBlobId(id: string): boolean {
  return BLOB_ID_PATTERN.test(id);
}

/** Lowercased final extension of a filename, or '' if it has none. */
export function extensionOf(filename: string): string {
  const parts = filename.split('.');
  if (parts.length < 2) return '';
  return (parts.pop() || '').toLowerCase();
}

export type UploadKind = 'image' | 'pdf' | 'text';

/**
 * Decide what an uploaded file actually is, from its extension cross-checked
 * against the browser-supplied MIME type. The extension leads because
 * browsers routinely send an empty `file.type` for .md and .txt; the MIME
 * type is only used to reject an outright contradiction. Returns null for
 * anything outside the policy, which callers turn into a 415.
 */
export function classifyUpload(filename: string, mimeType: string): UploadKind | null {
  const ext = extensionOf(filename);
  const mime = (mimeType || '').toLowerCase().split(';')[0].trim();

  if (ALLOWED_IMAGE_EXTS.has(ext)) {
    return !mime || ALLOWED_IMAGE_MIME.has(mime) ? 'image' : null;
  }
  if (ext === 'pdf') {
    return !mime || mime === 'application/pdf' ? 'pdf' : null;
  }
  if (ALLOWED_DOC_EXTS.has(ext)) {
    return !mime || mime.startsWith('text/') ? 'text' : null;
  }
  return null;
}

/**
 * The content type to PERSIST for an accepted upload. Always derived from
 * what the server decided the bytes are — never from the caller. Images are
 * transcoded to JPEG before storage (see IMAGE-NORMALISE-V1), so they are
 * always image/jpeg by the time this is read.
 */
export function storedContentTypeFor(kind: UploadKind, filename: string): string {
  if (kind === 'image') return 'image/jpeg';
  if (kind === 'pdf') return 'application/pdf';
  return extensionOf(filename) === 'txt' ? 'text/plain' : 'text/markdown';
}

/** The stored file extension for an accepted upload. */
export function storedExtensionFor(kind: UploadKind, filename: string): string {
  if (kind === 'image') return 'jpg';
  if (kind === 'pdf') return 'pdf';
  return extensionOf(filename) === 'txt' ? 'txt' : 'md';
}
