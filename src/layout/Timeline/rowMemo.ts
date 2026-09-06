/**
 * Prop equality for the timeline's memoised row subcomponents. Split out of
 * `Timeline.tsx` so every row file can share the one contract `rowMemo.test.ts`
 * pins.
 */

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Prop equality for the timeline's row subcomponents (track headers, lane
 * content, keyframes). The Timeline re-renders on every playback frame to move
 * the playhead — up to 60×/s — but none of these rows depend on the playhead,
 * so re-rendering them each frame is pure waste that made dense comps feel laggy
 * (the "not yet pleasant for dense compositions" note in ROADMAP.md).
 *
 * A plain shallow `memo` cannot help: every row is handed a freshly-built
 * `style` object and freshly-bound callbacks each render. But those callbacks
 * are all bound to a STABLE `track.id`, so a new closure identity is not a
 * behavioural change, and the geometry only changes on scroll or a row-height
 * switch, not per frame. So: ignore function identity, compare `style` by value,
 * and compare everything else by identity. Any real data change — the track
 * object, selection, index, expansion, geometry — still re-renders normally.
 */
export function areRowPropsEqual(prevProps: object, nextProps: object): boolean {
  const prev = prevProps as Record<string, unknown>;
  const next = nextProps as Record<string, unknown>;
  const keys = Object.keys(prev);
  if (keys.length !== Object.keys(next).length) return false;
  for (const key of keys) {
    const a = prev[key];
    const b = next[key];
    if (Object.is(a, b)) continue;
    // Callbacks are bound to stable ids; identity churn is not a real change.
    if (typeof a === 'function' && typeof b === 'function') continue;
    // Geometry arrives as a fresh object literal each render — compare by value.
    if (key === 'style' && isShallowEqualStyle(a, b)) continue;
    return false;
  }
  return true;
}

function isShallowEqualStyle(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = Object.keys(ao);
  if (keys.length !== Object.keys(bo).length) return false;
  for (const k of keys) if (!Object.is(ao[k], bo[k])) return false;
  return true;
}
