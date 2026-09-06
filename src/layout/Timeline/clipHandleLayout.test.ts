import { CLIP_BODY_MIN_PX, CLIP_HANDLE_PX, clipHandleLayout } from './clipHandleLayout';

describe('clipHandleLayout — trim handles yield to the body on a narrow bar', () => {
  it('a wide bar gets full-width handles and is not narrow', () => {
    expect(clipHandleLayout(200)).toEqual({ narrow: false, handleWidth: CLIP_HANDLE_PX });
    // Exactly three handle widths is the first "wide" bar.
    expect(clipHandleLayout(CLIP_HANDLE_PX * 3)).toEqual({ narrow: false, handleWidth: CLIP_HANDLE_PX });
  });

  it('below three handle widths the bar is narrow; the handles shrink once the body would go under the minimum', () => {
    // 29px still fits two full handles and a 9px body — narrow, but no shrink yet.
    const r29 = clipHandleLayout(CLIP_HANDLE_PX * 3 - 1);
    expect(r29).toEqual({ narrow: true, handleWidth: CLIP_HANDLE_PX });
    // 20px cannot: the handles give up pixels so 6px of body survive.
    const r20 = clipHandleLayout(20);
    expect(r20.narrow).toBe(true);
    expect(r20.handleWidth).toBeLessThan(CLIP_HANDLE_PX);
    expect(r20.handleWidth).toBeGreaterThan(0);
  });

  it('a narrow bar always keeps at least the minimum body between its handles', () => {
    for (let w = 1; w < CLIP_HANDLE_PX * 3; w++) {
      const { handleWidth } = clipHandleLayout(w);
      expect(w - 2 * handleWidth).toBeGreaterThanOrEqual(Math.min(w, CLIP_BODY_MIN_PX));
    }
  });

  it('a 2px clip has no handles at all — it must still be movable', () => {
    expect(clipHandleLayout(2)).toEqual({ narrow: true, handleWidth: 0 });
  });

  it('handles never exceed the nominal width even with a tiny body minimum', () => {
    expect(clipHandleLayout(29, 10, 0).handleWidth).toBe(10);
  });

  it('the regression: a 20px bar is no longer all handle', () => {
    const { handleWidth } = clipHandleLayout(20);
    expect(2 * handleWidth).toBeLessThan(20);
  });
});
