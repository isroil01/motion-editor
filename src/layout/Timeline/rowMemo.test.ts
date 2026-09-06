/**
 * Contract for `areRowPropsEqual` — the memo comparator that lets the timeline's
 * row subcomponents (track headers, lane content, keyframes) skip re-rendering
 * on the 60×/s playhead frames they don't depend on.
 *
 * The optimization's real hazard is a FALSE positive: reporting "equal" when a
 * genuine data change happened would leave the UI stale. These tests pin both
 * directions — skip on identity churn, re-render on real change.
 */
import { areRowPropsEqual } from './Timeline';

const noop = (): void => {};

describe('areRowPropsEqual', () => {
  it('is equal when nothing changed', () => {
    const track = { id: 'a' };
    const props = { track, index: 1, selected: false, onClick: noop };
    expect(areRowPropsEqual(props, { ...props })).toBe(true);
  });

  it('ignores callback identity churn (closures are bound to a stable id)', () => {
    const track = { id: 'a' };
    const prev = { track, index: 1, onClick: () => {}, onToggle: () => {} };
    const next = { track, index: 1, onClick: () => {}, onToggle: () => {} };
    // Different closure instances, same data → skip re-render.
    expect(areRowPropsEqual(prev, next)).toBe(true);
  });

  it('ignores a fresh style object with identical values', () => {
    const track = { id: 'a' };
    const prev = { track, style: { position: 'absolute', top: 30, height: 30 } };
    const next = { track, style: { position: 'absolute', top: 30, height: 30 } };
    expect(areRowPropsEqual(prev, next)).toBe(true);
  });

  it('re-renders when style geometry changes (scroll / row-height)', () => {
    const track = { id: 'a' };
    const prev = { track, style: { position: 'absolute', top: 30, height: 30 } };
    const next = { track, style: { position: 'absolute', top: 60, height: 30 } };
    expect(areRowPropsEqual(prev, next)).toBe(false);
  });

  it('re-renders when the track object is replaced (data changed)', () => {
    const prev = { track: { id: 'a' }, index: 1, selected: false };
    const next = { track: { id: 'a' }, index: 1, selected: false };
    // Different object identities for a NON-function, non-style prop → not equal.
    expect(areRowPropsEqual(prev, next)).toBe(false);
  });

  it('re-renders when a primitive data prop changes (selection, index, expanded)', () => {
    const track = { id: 'a' };
    expect(areRowPropsEqual({ track, selected: false }, { track, selected: true })).toBe(false);
    expect(areRowPropsEqual({ track, index: 1 }, { track, index: 2 })).toBe(false);
    expect(areRowPropsEqual({ track, expanded: true }, { track, expanded: false })).toBe(false);
  });

  it('re-renders when the prop set differs (added / removed key)', () => {
    const track = { id: 'a' };
    expect(areRowPropsEqual({ track }, { track, extra: 1 })).toBe(false);
  });

  it('treats a style prop that turns non-object as a change', () => {
    const track = { id: 'a' };
    expect(areRowPropsEqual({ track, style: { top: 1 } }, { track, style: undefined })).toBe(false);
  });
});

/**
 * The overlay identity contract: a drag hands the live preview ONLY to rows
 * that hold something being dragged, and a stable empty value to the rest —
 * which is what lets `areRowPropsEqual` skip every untouched row per move.
 */
import { EMPTY_KF_PREVIEW, kfPreviewForRow, previewsForRow } from './dragOverlay';

describe('drag overlay identity', () => {
  it('gives an untouched row null previews, stable across moves', () => {
    const clips = [{ id: 'c1' }, { id: 'c2' }];
    const move1 = [{ id: 'other', start: 0, duration: 1 }];
    const move2 = [{ id: 'other', start: 0.1, duration: 1 }];
    expect(previewsForRow(move1, clips)).toBeNull();
    expect(previewsForRow(move2, clips)).toBeNull();
    expect(previewsForRow(null, clips)).toBeNull();
    expect(previewsForRow(move1, undefined)).toBeNull();
  });

  it('hands the touched row the live list itself', () => {
    const clips = [{ id: 'c1' }];
    const move = [{ id: 'c1', start: 2, duration: 1 }];
    expect(previewsForRow(move, clips)).toBe(move);
  });

  it('keyframe rows share ONE empty map when none of theirs is dragged', () => {
    const live = new Map([['k9', 1.5]]);
    const row = [{ id: 'k1' }, { id: 'k2' }];
    expect(kfPreviewForRow(live, row)).toBe(EMPTY_KF_PREVIEW);
    expect(kfPreviewForRow(new Map(), row)).toBe(EMPTY_KF_PREVIEW);
    expect(kfPreviewForRow(live, [{ id: 'k9' }])).toBe(live);
  });

  it('so the row memo holds for untouched rows and breaks for touched ones', () => {
    const track = { id: 't' };
    const live1 = new Map([['k9', 1]]);
    const live2 = new Map([['k9', 2]]);
    const untouched = [{ id: 'k1' }];
    expect(
      areRowPropsEqual(
        { track, kfPreview: kfPreviewForRow(live1, untouched) },
        { track, kfPreview: kfPreviewForRow(live2, untouched) },
      ),
    ).toBe(true);
    const touched = [{ id: 'k9' }];
    expect(
      areRowPropsEqual(
        { track, kfPreview: kfPreviewForRow(live1, touched) },
        { track, kfPreview: kfPreviewForRow(live2, touched) },
      ),
    ).toBe(false);
  });
});
