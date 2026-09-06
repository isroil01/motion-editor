/**
 * assetListLogic — the pure half of the Assets panel: sorting, filtering,
 * searching, tag parsing and the readouts (bytes, duration, date).
 *
 * No React and no store imports, so every rule the panel applies to its rows
 * can be pinned by a unit test without standing the panel up. The panel
 * itself only wires these to state.
 */

import type { AssetSortKey, AssetTypeFilter, SortDir } from '@stores/assetsViewStore';

/** The slice of an asset these rules read. `ImportedAsset` satisfies it. */
export interface SortableAsset {
  id: string;
  name: string;
  type: 'image' | 'video' | 'audio';
  size: number;
  tags?: string[];
  label?: string;
  importedAt?: number;
  metadata?: { duration?: number };
}

export interface AssetFilters {
  query: string;
  unusedOnly: boolean;
  type: AssetTypeFilter;
  tag: string | null;
  label: string | null;
}

/** Human-readable file size for the Size column and the drawer. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + (sizes[i] ?? '');
}

/** `0:07`, `1:02`, `1:02:03` — the badge a clip's corner carries. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

/** Short date for the Date column: today shows a time, otherwise `12 Mar`. */
export function formatImportDate(ms: number | undefined, now: number = Date.now()): string {
  if (!ms || !Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const today = new Date(now);
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
  if (sameDay) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: '2-digit' });
}

/**
 * Turn what the user typed into the tag box into a tag list: split on commas,
 * trim, lower-case, drop empties and duplicates, keep the order typed. Tags
 * are case-insensitive by construction so "Logo" and "logo" cannot become two
 * filters for the same thing.
 */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/[,\n]/)) {
    const t = raw.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Every tag in use, alphabetically, with how many assets carry it. */
export function tagCounts(assets: ReadonlyArray<SortableAsset>): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const a of assets) for (const t of a.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((x, y) => x.tag.localeCompare(y.tag));
}

/** A search hit is a name OR a tag containing the query. */
export function matchesQuery(asset: SortableAsset, q: string): boolean {
  if (!q) return true;
  if (asset.name.toLowerCase().includes(q)) return true;
  return (asset.tags ?? []).some((t) => t.includes(q));
}

export function filterAssets<T extends SortableAsset>(
  assets: ReadonlyArray<T>,
  filters: AssetFilters,
  usedCount: (assetId: string) => number,
): T[] {
  const q = filters.query.trim().toLowerCase();
  return assets.filter((a) => {
    if (filters.type !== 'all' && a.type !== filters.type) return false;
    if (filters.unusedOnly && usedCount(a.id) > 0) return false;
    if (filters.tag && !(a.tags ?? []).includes(filters.tag)) return false;
    if (filters.label && a.label !== filters.label) return false;
    return matchesQuery(a, q);
  });
}

export function isFilterActive(filters: Omit<AssetFilters, 'query'>): boolean {
  return filters.unusedOnly || filters.type !== 'all' || filters.tag !== null || filters.label !== null;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Type ordering for the Type column: what a bin lists together. */
const TYPE_RANK: Record<SortableAsset['type'], number> = { video: 0, image: 1, audio: 2 };

/**
 * The PRIMARY comparison for a column — 0 when the column cannot separate the
 * two rows. The name tiebreak lives in `sortAssets` instead, so that flipping
 * a column's direction reverses the column and leaves equal rows alphabetical.
 */
export function compareAssets(
  a: SortableAsset,
  b: SortableAsset,
  key: AssetSortKey,
  usedCount: (assetId: string) => number,
): number {
  switch (key) {
    case 'type':
      return TYPE_RANK[a.type] - TYPE_RANK[b.type];
    case 'size':
      return a.size - b.size;
    case 'date':
      return (a.importedAt ?? 0) - (b.importedAt ?? 0);
    case 'used':
      return usedCount(a.id) - usedCount(b.id);
    case 'name':
    default:
      return collator.compare(a.name, b.name);
  }
}

/**
 * A sorted COPY. Direction is applied once, to the column only: rows the
 * column cannot separate stay in ascending name order in BOTH directions, so
 * toggling Size does not reshuffle every same-sized file.
 */
export function sortAssets<T extends SortableAsset>(
  assets: ReadonlyArray<T>,
  key: AssetSortKey,
  dir: SortDir,
  usedCount: (assetId: string) => number,
): T[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...assets].sort(
    (a, b) => sign * compareAssets(a, b, key, usedCount) || collator.compare(a.name, b.name),
  );
}

/**
 * asset id → the layer ids that use it. `idOf` is injected so this stays
 * pure; the panel passes `assetIdOf` from `@core/source/sourceInfo`.
 */
export function usageByAsset<N extends { id: string }>(
  nodes: Iterable<N>,
  idOf: (node: N) => string | null,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const n of nodes) {
    const assetId = idOf(n);
    if (!assetId) continue;
    const list = out.get(assetId);
    if (list) list.push(n.id);
    else out.set(assetId, [n.id]);
  }
  return out;
}
