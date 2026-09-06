/**
 * The transient playhead lives OUTSIDE the immer project store.
 *
 * The contract worth pinning: a playback tick moves `useCurrentTime` readers
 * and nobody else. Before this store, every tick re-created the active tab
 * through immer and re-ran every project-store selector in the app, so a
 * component subscribed to the tab OBJECT re-rendered 60×/s whether or not it
 * cared about time. The project store keeps an authoritative copy, refreshed
 * only at coarse moments — and those moments are pinned here too, because a
 * save or an undo baseline that read a stale playhead would be a quieter bug
 * than the re-render storm was.
 */

import { createElement, useRef } from 'react';
import { act, render } from '@testing-library/react';
import { getEventBus } from '@core/events/EventBus';
import { useProjectStore } from './projectStore';
import {
  PLAYBACK_MIRROR_INTERVAL_MS,
  commitTime,
  getFrame,
  getTime,
  setTime,
  subscribeTime,
  useCurrentTime,
  usePlaybackClockStore,
} from './playbackClockStore';

const activeId = (): string => useProjectStore.getState().activeTabId!;

/** A component that reads the live playhead and counts its own renders. */
function TimeReader({ renders }: { renders: { count: number } }): null {
  const t = useCurrentTime();
  const ref = useRef(t);
  ref.current = t;
  renders.count += 1;
  return null;
}

/** A component subscribed to the whole active tab object — the old hot path. */
function TabObjectReader({ renders }: { renders: { count: number } }): null {
  useProjectStore((s) => (s.activeTabId ? s.tabs[s.activeTabId] : null));
  renders.count += 1;
  return null;
}

beforeEach(() => {
  const ws = useProjectStore.getState();
  ws.actions.resetTabs();
  ws.actions.setPlaying(false);
  usePlaybackClockStore.setState({ clocks: {} });
});

describe('playbackClockStore', () => {
  it('sets and reads the clock per tab, deriving the frame from the comp fps', () => {
    const id = activeId();
    setTime(id, 1.5);
    expect(getTime(id)).toBe(1.5);
    expect(getFrame(id)).toBe(45); // 30fps default comp
    setTime(id, 2, 61);
    expect(getFrame(id)).toBe(61);
    // The active tab is the default subject.
    expect(getTime()).toBe(2);
  });

  it('emits TimeChanged on every write so bus subscribers keep working', () => {
    const seen: Array<{ time: number; frame: number }> = [];
    const sub = getEventBus().on('TimeChanged', (p) => seen.push(p));
    setTime(activeId(), 0.5, 15);
    sub.dispose();
    expect(seen).toEqual([{ time: 0.5, frame: 15 }]);
  });

  it('subscribeTime fires for its tab only, with time and frame, until unsubscribed', () => {
    const id = activeId();
    const other = useProjectStore.getState().actions.openTab('comp_other');
    useProjectStore.getState().actions.setActiveTab(id);
    const got: Array<[number, number]> = [];
    const off = subscribeTime(id, (t, f) => got.push([t, f]));
    setTime(other, 3, 90);
    setTime(id, 1, 30);
    setTime(id, 1, 30); // same value: no callback
    off();
    setTime(id, 2, 60);
    expect(got).toEqual([[1, 30]]);
  });

  it('mirrors every paused seek into the project store immediately', () => {
    const id = activeId();
    setTime(id, 4, 120);
    const tab = useProjectStore.getState().tabs[id]!;
    expect(tab.time).toBe(4);
    expect(tab.frame).toBe(120);
  });

  it('throttles the project-store mirror while playing and commits on pause', () => {
    const id = activeId();
    const nowSpy = jest.spyOn(performance, 'now');
    let clock = 10_000;
    nowSpy.mockImplementation(() => clock);
    try {
      useProjectStore.getState().actions.setPlaying(true);
      let projectWrites = 0;
      const off = useProjectStore.subscribe((s, prev) => {
        if (s.tabs[id]?.time !== prev.tabs[id]?.time) projectWrites += 1;
      });

      // Ten frames inside one mirror window: the tab record moves at most once.
      for (let f = 1; f <= 10; f += 1) {
        clock += 16;
        setTime(id, f / 30, f);
      }
      expect(projectWrites).toBeLessThanOrEqual(1);
      expect(getFrame(id)).toBe(10);

      // Past the window it mirrors again.
      clock += PLAYBACK_MIRROR_INTERVAL_MS + 1;
      setTime(id, 11 / 30, 11);
      expect(useProjectStore.getState().tabs[id]?.frame).toBe(11);

      // More frames, then pause: the LAST frame becomes authoritative.
      clock += 16;
      setTime(id, 12 / 30, 12);
      clock += 16;
      setTime(id, 13 / 30, 13);
      expect(useProjectStore.getState().tabs[id]?.frame).toBe(11);
      useProjectStore.getState().actions.setPlaying(false);
      expect(useProjectStore.getState().tabs[id]?.frame).toBe(13);
      expect(useProjectStore.getState().tabs[id]?.time).toBeCloseTo(13 / 30, 9);
      off();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('does not re-render a tab-object subscriber per frame while playing', () => {
    const id = activeId();
    const nowSpy = jest.spyOn(performance, 'now');
    let clock = 50_000;
    nowSpy.mockImplementation(() => clock);
    try {
      act(() => { useProjectStore.getState().actions.setPlaying(true); });
      const timeRenders = { count: 0 };
      const tabRenders = { count: 0 };
      render(createElement('div', null,
        createElement(TimeReader, { renders: timeRenders }),
        createElement(TabObjectReader, { renders: tabRenders }),
      ));
      const timeBefore = timeRenders.count;
      const tabBefore = tabRenders.count;

      for (let f = 1; f <= 10; f += 1) {
        clock += 16;
        act(() => { setTime(id, f / 30, f); });
      }

      // The time reader followed every frame…
      expect(timeRenders.count - timeBefore).toBe(10);
      // …and the tab-object reader saw at most the one throttled mirror.
      expect(tabRenders.count - tabBefore).toBeLessThanOrEqual(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('useCurrentTime re-renders only when the number changes', () => {
    const id = activeId();
    const renders = { count: 0 };
    render(createElement(TimeReader, { renders }));
    const before = renders.count;
    act(() => { setTime(id, 1, 30); });
    act(() => { setTime(id, 1, 30); });
    // An unrelated project-store write (dirty flag) is invisible to it.
    act(() => { useProjectStore.getState().actions.markDirty(id, true); });
    expect(renders.count - before).toBe(1);
  });

  it('commits the outgoing tab on a tab switch', () => {
    const id = activeId();
    const nowSpy = jest.spyOn(performance, 'now');
    let clock = 90_000;
    nowSpy.mockImplementation(() => clock);
    try {
      const ws = useProjectStore.getState();
      ws.actions.setPlaying(true);
      clock += 16;
      setTime(id, 1, 30);
      clock += 16;
      setTime(id, 2, 60); // inside the window: not mirrored yet
      expect(useProjectStore.getState().tabs[id]?.frame).toBe(30);
      const other = useProjectStore.getState().actions.openTab('comp_b');
      expect(other).not.toBe(id);
      expect(useProjectStore.getState().tabs[id]?.frame).toBe(60);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('adopts project-store writes: legacy setTime, document hydrate, closed tabs', () => {
    const id = activeId();
    // A caller that still seeks through the project store moves the live clock.
    useProjectStore.getState().actions.setTime(2.5, 75);
    expect(getTime(id)).toBe(2.5);
    expect(getFrame(id)).toBe(75);

    // A document load seeds the clocks for every tab it restores.
    useProjectStore.getState().actions.hydrateWorkspaceTabs({
      tabOrder: ['tab_a', 'tab_b'],
      activeTabId: 'tab_b',
      tabs: {
        tab_a: { id: 'tab_a', compositionId: 'comp_a', breadcrumbPath: ['comp_a'], title: 'A', time: 1, frame: 30 },
        tab_b: { id: 'tab_b', compositionId: 'comp_b', breadcrumbPath: ['comp_b'], title: 'B', time: 3, frame: 90 },
      },
    });
    expect(getTime('tab_a')).toBe(1);
    expect(getTime('tab_b')).toBe(3);
    expect(getTime()).toBe(3);
    // The old tab's clock left with the tab.
    expect(usePlaybackClockStore.getState().clocks[id]).toBeUndefined();

    useProjectStore.getState().actions.closeTab('tab_a');
    expect(usePlaybackClockStore.getState().clocks['tab_a']).toBeUndefined();
    expect(usePlaybackClockStore.getState().clocks['tab_b']).toEqual({ time: 3, frame: 90 });
  });

  it('commitTime writes the live value into the tab record on demand', () => {
    const id = activeId();
    const nowSpy = jest.spyOn(performance, 'now');
    let clock = 120_000;
    nowSpy.mockImplementation(() => clock);
    try {
      useProjectStore.getState().actions.setPlaying(true);
      clock += 16;
      setTime(id, 1, 30);
      clock += 16;
      setTime(id, 1.5, 45);
      expect(useProjectStore.getState().tabs[id]?.frame).toBe(30);
      commitTime(id);
      expect(useProjectStore.getState().tabs[id]?.frame).toBe(45);
    } finally {
      nowSpy.mockRestore();
    }
  });
});
