/**
 * Focus modes: enter collapses, toggle restores, switching keeps the
 * original snapshot so leaving from EITHER mode puts the user's layout back.
 */

import { useLayoutStore } from './layoutStore';

const collapsedOf = () => {
  const r = useLayoutStore.getState().regions;
  return {
    left: r.leftSidebar.collapsed,
    right: r.rightInspector.collapsed,
    timeline: r.bottomTimeline.collapsed,
  };
};

beforeEach(() => {
  const s = useLayoutStore.getState();
  s.setFocusMode('none');
  s.setCollapsed('leftSidebar', false);
  s.setCollapsed('rightInspector', true); // the user had the inspector closed
  s.setCollapsed('bottomTimeline', false);
});

describe('layoutStore focus modes', () => {
  it('viewport-timeline hides the sidebars and keeps the timeline', () => {
    useLayoutStore.getState().setFocusMode('viewport-timeline');
    expect(useLayoutStore.getState().focusMode).toBe('viewport-timeline');
    expect(collapsedOf()).toEqual({ left: true, right: true, timeline: false });
  });

  it('viewport hides everything', () => {
    useLayoutStore.getState().setFocusMode('viewport');
    expect(collapsedOf()).toEqual({ left: true, right: true, timeline: true });
  });

  it('toggling the same mode restores exactly what the user had', () => {
    useLayoutStore.getState().setFocusMode('viewport');
    useLayoutStore.getState().setFocusMode('viewport');
    expect(useLayoutStore.getState().focusMode).toBe('none');
    expect(useLayoutStore.getState().focusModeRestore).toBeNull();
    // The inspector was closed BEFORE — it stays closed, it is not force-opened.
    expect(collapsedOf()).toEqual({ left: false, right: true, timeline: false });
  });

  it('switching modes keeps the original snapshot, so leaving from the second restores the first layout', () => {
    useLayoutStore.getState().setFocusMode('viewport-timeline');
    useLayoutStore.getState().setFocusMode('viewport');
    expect(collapsedOf()).toEqual({ left: true, right: true, timeline: true });
    // Back to viewport-timeline: timeline reappears, sidebars stay hidden.
    useLayoutStore.getState().setFocusMode('viewport-timeline');
    expect(collapsedOf()).toEqual({ left: true, right: true, timeline: false });
    useLayoutStore.getState().setFocusMode('none');
    expect(collapsedOf()).toEqual({ left: false, right: true, timeline: false });
  });

  it('leaving when not in a mode is a no-op', () => {
    useLayoutStore.getState().setFocusMode('none');
    expect(collapsedOf()).toEqual({ left: false, right: true, timeline: false });
  });
});
