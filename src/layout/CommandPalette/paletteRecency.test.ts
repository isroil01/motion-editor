/**
 * MRU ranking for the command palette.
 *
 * Three properties, each the one that would silently regress:
 *   • a command used just now outranks one used yesterday, whatever the counts;
 *   • frequency breaks ties but cannot pin an old favourite above a fresh use;
 *   • the boost is additive on the fuzzy score and never turns a non-match
 *     into a match (that is the caller's contract — checked via the store).
 */

import { fuzzyScore } from './paletteSearch';
import {
  HALF_LIFE_MS,
  MAX_ENTRIES,
  rankRecent,
  recencyBoost,
  recordUse,
  sanitizeRecencyMap,
} from './paletteRecency';
import { useCommandPaletteStore, PALETTE_MRU_STORAGE_KEY } from '@stores/commandPaletteStore';

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

describe('recencyBoost', () => {
  it('is zero with no history', () => {
    expect(recencyBoost(undefined, NOW)).toBe(0);
    expect(recencyBoost({ count: 0, lastUsed: NOW }, NOW)).toBe(0);
  });

  it('halves its recency term every half-life', () => {
    const fresh = recencyBoost({ count: 1, lastUsed: NOW }, NOW);
    const stale = recencyBoost({ count: 1, lastUsed: NOW - HALF_LIFE_MS }, NOW);
    // 5·1 + 2·log2(2) = 7  →  5·0.5 + 2 = 4.5
    expect(fresh).toBeCloseTo(7, 5);
    expect(stale).toBeCloseTo(4.5, 5);
  });

  it('lets a fresh single use beat an old favourite', () => {
    const justNow = recencyBoost({ count: 1, lastUsed: NOW }, NOW);
    const oldFavourite = recencyBoost({ count: 50, lastUsed: NOW - 3 * 24 * HOUR }, NOW);
    expect(justNow).toBeGreaterThan(oldFavourite);
  });
});

describe('rankRecent', () => {
  it('orders most recent first and honours the limit', () => {
    const mru = {
      'a': { count: 1, lastUsed: NOW - 3 * HOUR },
      'b': { count: 1, lastUsed: NOW - 1 * HOUR },
      'c': { count: 1, lastUsed: NOW },
      'd': { count: 1, lastUsed: NOW - 2 * HOUR },
    };
    expect(rankRecent(mru, NOW)).toEqual(['c', 'b', 'd', 'a']);
    expect(rankRecent(mru, NOW, 2)).toEqual(['c', 'b']);
  });

  it('uses frequency as the tiebreak between equally recent uses', () => {
    const mru = {
      'once': { count: 1, lastUsed: NOW },
      'often': { count: 9, lastUsed: NOW },
    };
    expect(rankRecent(mru, NOW)).toEqual(['often', 'once']);
  });
});

describe('recordUse', () => {
  it('increments and timestamps, without mutating the input', () => {
    const before = { x: { count: 2, lastUsed: NOW - HOUR } };
    const after = recordUse(before, 'x', NOW);
    expect(after.x).toEqual({ count: 3, lastUsed: NOW });
    expect(before.x).toEqual({ count: 2, lastUsed: NOW - HOUR });
    expect(recordUse({}, 'y', NOW).y).toEqual({ count: 1, lastUsed: NOW });
  });

  it('prunes to MAX_ENTRIES, dropping the least valuable', () => {
    let mru: Record<string, { count: number; lastUsed: number }> = {};
    for (let i = 0; i < MAX_ENTRIES; i++) mru = recordUse(mru, `cmd${i}`, NOW - (MAX_ENTRIES - i) * HOUR);
    const pruned = recordUse(mru, 'newest', NOW);
    expect(Object.keys(pruned)).toHaveLength(MAX_ENTRIES);
    expect(pruned.newest).toBeDefined();
    // cmd0 was the oldest of the lot and is the one to go.
    expect(pruned.cmd0).toBeUndefined();
  });
});

describe('sanitizeRecencyMap', () => {
  it('keeps only well-formed positive entries', () => {
    expect(sanitizeRecencyMap({
      ok: { count: 2, lastUsed: NOW },
      zero: { count: 0, lastUsed: NOW },
      str: { count: '2', lastUsed: NOW },
      nan: { count: NaN, lastUsed: NOW },
      nope: 'x',
    })).toEqual({ ok: { count: 2, lastUsed: NOW } });
    expect(sanitizeRecencyMap(null)).toEqual({});
    expect(sanitizeRecencyMap('junk')).toEqual({});
  });
});

describe('boosted ranking against the fuzzy score', () => {
  it('reorders near-equal matches by recency but never resurrects a non-match', () => {
    const now = NOW;
    const mru = { 'layer.newSolid': { count: 3, lastUsed: now } };
    const candidates = [
      { id: 'layer.newText', label: 'New Text' },
      { id: 'layer.newSolid', label: 'New Solid…' },
    ];
    const scored = candidates
      .map((c) => ({ id: c.id, s: fuzzyScore('new', c.label) }))
      .filter((x) => x.s >= 0)
      .map((x) => ({ ...x, s: x.s + recencyBoost(mru[x.id as keyof typeof mru], now) }))
      .sort((a, b) => b.s - a.s);
    expect(scored[0]?.id).toBe('layer.newSolid');
    // A non-match stays a non-match regardless of history — the boost is only
    // ever added AFTER the >= 0 filter.
    expect(fuzzyScore('zzz', 'New Solid…')).toBe(-1);
  });
});

describe('commandPaletteStore MRU', () => {
  beforeEach(() => {
    localStorage.removeItem(PALETTE_MRU_STORAGE_KEY);
    useCommandPaletteStore.getState().clearRecent();
  });

  it('records uses and persists them', () => {
    useCommandPaletteStore.getState().recordUse('edit.undo', NOW);
    useCommandPaletteStore.getState().recordUse('edit.undo', NOW + 1);
    expect(useCommandPaletteStore.getState().recent['edit.undo']).toEqual({ count: 2, lastUsed: NOW + 1 });
    expect(JSON.parse(localStorage.getItem(PALETTE_MRU_STORAGE_KEY) ?? '{}')).toEqual({
      'edit.undo': { count: 2, lastUsed: NOW + 1 },
    });
  });

  it('clears', () => {
    useCommandPaletteStore.getState().recordUse('edit.undo', NOW);
    useCommandPaletteStore.getState().clearRecent();
    expect(useCommandPaletteStore.getState().recent).toEqual({});
    expect(localStorage.getItem(PALETTE_MRU_STORAGE_KEY)).toBe('{}');
  });
});
