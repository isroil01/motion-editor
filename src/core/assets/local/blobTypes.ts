/**
 * Local (content-addressed) asset types.
 *
 * Distinct from `AssetService` (the cloud/URL asset registry): under local-first,
 * every imported asset has canonical BYTES on disk in the project's bundle,
 * addressed by the SHA-256 of its content. A node references an asset by `id`;
 * the bytes live once per unique content (`hash`), so importing the same file
 * twice stores one blob.
 */

export type LocalAssetType = 'image' | 'video' | 'audio' | 'json' | 'font' | 'other';

/** A row in `assets/registry.json`. Points at a blob by content hash. */
export interface AssetRecord {
  /** Stable id nodes reference. Derived from the hash → dedup-friendly. */
  id: string;
  /** SHA-256 hex of the bytes — the content address / blob name. */
  hash: string;
  name: string;
  type: LocalAssetType;
  mime: string;
  /** Byte length. */
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  /**
   * The user's organisation of the library — tags and a colour label — kept
   * WITH the bundle so it travels with the project rather than living only in
   * one machine's localStorage. Optional and absent for most records; a
   * registry written before these existed reads back unchanged.
   */
  tags?: string[];
  label?: string;
}

/** Serialized `assets/registry.json`. */
export interface AssetRegistryFile {
  version: string;
  assets: AssetRecord[];
}

/** Map a MIME type to a coarse asset kind. */
export function inferAssetType(mime: string): LocalAssetType {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/json') return 'json';
  if (mime.startsWith('font/') || mime.includes('font')) return 'font';
  return 'other';
}
