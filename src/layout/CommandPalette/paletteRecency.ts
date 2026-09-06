/**
 * Recent / frequent commands for the palette — the pure half.
 *
 * The store (`commandPaletteStore`) keeps an MRU map of command id → how
 * often it ran and when it last ran. This module turns that map into two
 * things the palette needs and nothing else:
 *
 *   • a RANKED list for the "Recent" section shown while the query is empty;
 *   • a SCORE BOOST folded into the fuzzy score while the user types, so a
 *     command used a minute ago outranks a stranger with the same letters.
 *
 * Both are pure functions of (mru, now) so they can be tested without React,
 * a DOM or a registry. No decay maths beyond a half-life: the boost halves
 * every `HALF_LIFE_MS`, and frequency adds a logarithmic term so a command run
 * a hundred times does not permanently pin itself above everything typed.
 */

export interface RecencyEntry {
  /** How many times the command has run from the palette. */
  count: number;
  /** `Date.now()` of the last run. */
  lastUsed: number;
}

export type RecencyMap = Readonly<Record<string, RecencyEntry>>;

/** After this long, a use is worth half of what it was. One working day. */
export const HALF_LIFE_MS = 8 * 60 * 60 * 1000;

/** Never keep more than this many ids — the map is persisted, not a log. */
export const MAX_ENTRIES = 40;

/** Rows in the empty-state "Recent" section. */
export const RECENT_SECTION_SIZE = 6;

/**
 * The boost a command earns from its history, in the same units as
 * `fuzzyScore` — a fresh use is worth about one contiguous-match bonus, so it
 * breaks ties and reorders near-misses without overriding a clearly better
 * textual match.
 */
export function recencyBoost(entry: RecencyEntry | undefined, now: number): number {
  if (!entry || entry.count <= 0) return 0;
  const age = Math.max(0, now - entry.lastUsed);
  const recency = Math.pow(0.5, age / HALF_LIFE_MS); // 1 → 0 over days
  const frequency = Math.log2(1 + entry.count);      // 1, 1.58, 2, 2.32…
  // Frequency counts in full for the first half-life, then fades with the
  // recency term: without this an id run fifty times last week stayed above
  // a command run once a second ago, which is the opposite of "recent".
  const frequencyWeight = Math.min(1, 2 * recency);
  return 5 * recency + 2 * frequency * frequencyWeight;
}

/**
 * Ids for the "Recent" section, best first. Recency dominates — this section
 * is "what did I just do", not "what do I do most" — with frequency as the
 * tiebreak through the same boost formula.
 */
export function rankRecent(mru: RecencyMap, now: number, limit = RECENT_SECTION_SIZE): string[] {
  return Object.entries(mru)
    .filter(([, e]) => e.count > 0)
    .sort((a, b) => recencyBoost(b[1], now) - recencyBoost(a[1], now) || b[1].lastUsed - a[1].lastUsed)
    .slice(0, limit)
    .map(([id]) => id);
}

/** A new map with `id` recorded as used at `now`, pruned to `MAX_ENTRIES`. */
export function recordUse(mru: RecencyMap, id: string, now: number): Record<string, RecencyEntry> {
  const prev = mru[id];
  const next: Record<string, RecencyEntry> = {
    ...mru,
    [id]: { count: (prev?.count ?? 0) + 1, lastUsed: now },
  };
  const ids = Object.keys(next);
  if (ids.length <= MAX_ENTRIES) return next;
  // Drop the least valuable until we fit — the ones whose boost is lowest.
  const keep = new Set(
    ids.sort((a, b) => recencyBoost(next[b], now) - recencyBoost(next[a], now)).slice(0, MAX_ENTRIES),
  );
  for (const k of ids) if (!keep.has(k)) delete next[k];
  return next;
}

/**
 * Validate something read back from storage. Anything that is not a plain
 * object of `{ count: number, lastUsed: number }` is dropped rather than
 * trusted — a corrupt entry must not take the palette down.
 */
export function sanitizeRecencyMap(raw: unknown): Record<string, RecencyEntry> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, RecencyEntry> = {};
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object') continue;
    const { count, lastUsed } = v as { count?: unknown; lastUsed?: unknown };
    if (typeof count !== 'number' || typeof lastUsed !== 'number') continue;
    if (!Number.isFinite(count) || !Number.isFinite(lastUsed) || count <= 0) continue;
    out[id] = { count, lastUsed };
  }
  return out;
}
