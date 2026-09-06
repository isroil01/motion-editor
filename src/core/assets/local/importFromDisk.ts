/**
 * importFromDisk — turn a PATH into a library asset, on the desktop.
 *
 * The Assets panel's Browse tab lists a folder straight off the disk; a row
 * there is a file name and a path, not a `File`. Every importer the store
 * has wants a `File`, so this reads the bytes over the shell IPC, wraps them,
 * and hands them to `addAsset` with the origin path attached — which is what
 * lets "Reveal in Explorer" open the original later.
 *
 * Absent in the browser build (`window.motionEditor.file.readBytes` is not
 * there), and the panel hides the Browse tab before this could be reached.
 *
 * Deliberately knows nothing about the browser's own media filter
 * (`layout/Assets/mediaBrowserTree`): `core` does not import `layout`, and
 * the caller has already decided the row is media before it drags it.
 */

import { useAssetStore, type ImportedAsset } from '@stores/assetStore';
import { shortId } from '@utils/lang';

const MIME: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska',
  avi: 'video/x-msvideo', mpg: 'video/mpeg', mpeg: 'video/mpeg', wmv: 'video/x-ms-wmv',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg',
  flac: 'audio/flac', aif: 'audio/aiff', aiff: 'audio/aiff', opus: 'audio/opus',
};

/** The last path segment, whichever separator the OS uses. */
export function fileNameOf(p: string): string {
  const trimmed = p.replace(/[\\/]+$/, '');
  const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return i === -1 ? trimmed : trimmed.slice(i + 1);
}

/** Best-effort MIME from the extension; the store falls back to the
 *  extension itself for the containers the browser has no type for. */
export function mimeForPath(p: string): string {
  const name = fileNameOf(p).toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return MIME[ext] ?? '';
}

/** Whether this build can import from a path at all. */
export function canImportFromDisk(): boolean {
  return typeof window !== 'undefined' && typeof window.motionEditor?.file?.readBytes === 'function';
}

/** A fresh id the caller may hand to a drag payload before the import lands. */
export function mintAssetId(): string {
  return `asset_${shortId()}`;
}

/**
 * Read the file and add it to the library. Resolves to the new asset, or
 * null when the path cannot be read (moved, unreadable). Never throws: a
 * failed import is a notification's job, not an exception's.
 */
export async function importMediaFile(
  path: string,
  opts: { id?: string; folderId?: string | null } = {},
): Promise<ImportedAsset | null> {
  const read = window.motionEditor?.file?.readBytes;
  if (!read) return null;
  const name = fileNameOf(path);
  let bytes: Uint8Array | null = null;
  try {
    bytes = await read(path);
  } catch {
    bytes = null;
  }
  if (!bytes || bytes.byteLength === 0) return null;
  // A fresh ArrayBuffer copy: the IPC-delivered view may sit on a larger,
  // shared buffer and `File` would carry the whole thing.
  const file = new File([bytes.slice()], name, { type: mimeForPath(path) });
  try {
    return await useAssetStore.getState().addAsset(file, opts.folderId ?? null, {
      path,
      ...(opts.id ? { id: opts.id } : {}),
    });
  } catch {
    return null;
  }
}
