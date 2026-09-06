/**
 * The top bar collapses on ITS width, measured by a ResizeObserver — not on
 * the window's. The observer is mocked so the hook is driven directly.
 */

import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { collapseFor, COLLAPSE_BELOW } from './toolbarCollapse';
import { useElementWidth } from './useElementWidth';

describe('collapseFor', () => {
  it('demotes groups in the documented order as width shrinks', () => {
    expect(collapseFor(1400)).toEqual({
      hidePuppet: false, hideMask: false, hideSnap: false, hideAnimate: false, hideUndoRedo: false, hideSceneControls: false,
    });
    expect(collapseFor(COLLAPSE_BELOW.puppet - 1).hidePuppet).toBe(true);
    expect(collapseFor(COLLAPSE_BELOW.puppet - 1).hideMask).toBe(false);
    expect(collapseFor(COLLAPSE_BELOW.mask - 1).hideMask).toBe(true);
    expect(collapseFor(COLLAPSE_BELOW.snap - 1).hideSnap).toBe(true);
    expect(collapseFor(700)).toEqual({
      hidePuppet: true, hideMask: true, hideSnap: true, hideAnimate: true, hideUndoRedo: true, hideSceneControls: true,
    });
  });
});

describe('useElementWidth', () => {
  type Cb = (entries: Array<{ contentRect: { width: number } }>) => void;
  let callbacks: Cb[];
  let observed: Element[];
  let disconnected: number;
  const RealRO = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;

  beforeEach(() => {
    callbacks = [];
    observed = [];
    disconnected = 0;
    class MockRO {
      constructor(cb: Cb) { callbacks.push(cb); }
      observe(el: Element): void { observed.push(el); }
      disconnect(): void { disconnected += 1; }
      unobserve(): void { /* unused */ }
    }
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = MockRO;
  });
  afterEach(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = RealRO;
  });

  it('observes the element and reports the width the observer delivers', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const { result, unmount } = renderHook(() => {
      const ref = useRef<HTMLDivElement>(el);
      return useElementWidth(ref, 1000);
    });
    expect(observed).toEqual([el]);
    act(() => callbacks[0]!([{ contentRect: { width: 640 } }]));
    expect(result.current).toBe(640);
    expect(collapseFor(result.current).hideMask).toBe(true);
    act(() => callbacks[0]!([{ contentRect: { width: 1300 } }]));
    expect(result.current).toBe(1300);
    expect(collapseFor(result.current).hidePuppet).toBe(false);
    // A zero from a hidden element is ignored rather than collapsing everything.
    act(() => callbacks[0]!([{ contentRect: { width: 0 } }]));
    expect(result.current).toBe(1300);
    unmount();
    expect(disconnected).toBe(1);
    el.remove();
  });

  it('is independent of window.innerWidth once observed', () => {
    const el = document.createElement('div');
    const { result } = renderHook(() => useElementWidth(useRef<HTMLDivElement>(el)));
    act(() => callbacks[0]!([{ contentRect: { width: 800 } }]));
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(result.current).toBe(800);
  });
});
