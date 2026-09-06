/**
 * The "what changed" lane's SOURCE SELECTION.
 *
 * The lane has two baselines and they answer different questions — "since I
 * saved" and "what did the last AI run touch" — so the bug this guards against
 * is the one where both return the same set, which looks entirely plausible on
 * screen and makes the AI answer worthless.
 *
 * Everything below is the pure half (`captureHeatSnapshot`, `diffHeat`,
 * `isKeyframeHot`, `heatFor`) driven against the real animation engine. The
 * SUBSCRIPTIONS are deliberately not exercised: `attachHeatSources` binds to
 * the event bus and the CommandSystem, and a test that stood both of those up
 * would be testing the bus.
 */

import { defaultAnimation, makeKeyframeId, POSITION_PSEUDO_PROP } from '@motion/animation';
import {
  captureHeatSnapshot,
  diffHeat,
  heatFor,
  heatKeyOf,
  isKeyframeHot,
  markHeatAiRun,
  markHeatSaved,
  resetHeatForTest,
} from './changeHeat';

const NODE = 'heat_node';

beforeEach(() => {
  resetHeatForTest();
  defaultAnimation.clear();
});

function key(prop: string, t: number, value: number): void {
  defaultAnimation.setKeyframe(NODE, prop, t, value);
}

describe('fingerprint and diff', () => {
  it('reports nothing when nothing has moved', () => {
    key('opacity', 0, 0);
    const before = captureHeatSnapshot();
    const diff = diffHeat(before, captureHeatSnapshot());
    expect(diff.keys.size).toBe(0);
    expect(diff.clipIds.size).toBe(0);
  });

  it('catches an ADDED keyframe', () => {
    key('opacity', 0, 0);
    const before = captureHeatSnapshot();
    key('opacity', 1, 100);
    expect(diffHeat(before, captureHeatSnapshot()).keys).toContain(heatKeyOf(NODE, 'opacity', 1));
  });

  it('catches a REMOVED keyframe', () => {
    key('opacity', 0, 0);
    key('opacity', 1, 100);
    const before = captureHeatSnapshot();
    defaultAnimation.removeKeyframe(NODE, 'opacity', 1);
    expect(diffHeat(before, captureHeatSnapshot()).keys).toContain(heatKeyOf(NODE, 'opacity', 1));
  });

  it('catches a VALUE change at a time that did not move', () => {
    key('opacity', 0, 0);
    const before = captureHeatSnapshot();
    key('opacity', 0, 50);
    // A fingerprint of TIME alone would call this unchanged — which is the
    // most common single edit there is.
    expect(diffHeat(before, captureHeatSnapshot()).keys).toContain(heatKeyOf(NODE, 'opacity', 0));
  });
});

describe('source selection', () => {
  it('answers nothing for a baseline that was never taken', () => {
    key('opacity', 0, 0);
    // No `markHeatSaved` / `markHeatAiRun` yet: an un-baselined source has to
    // report EMPTY, not "everything", or turning the lane on for the first
    // time lights the whole comp.
    expect(heatFor('save').keys.size).toBe(0);
    expect(heatFor('ai').keys.size).toBe(0);
  });

  it('keeps the two baselines apart', () => {
    key('opacity', 0, 0);
    markHeatSaved();

    // An edit the USER made after saving.
    key('opacity', 1, 100);
    const beforeRun = captureHeatSnapshot();

    // Then a "run" edits something else.
    key('rotation', 2, 45);
    markHeatAiRun(beforeRun);

    const save = heatFor('save');
    const ai = heatFor('ai');

    // "Since save" covers both edits; "the last run" covers only its own.
    expect(save.keys).toContain(heatKeyOf(NODE, 'opacity', 1));
    expect(save.keys).toContain(heatKeyOf(NODE, 'rotation', 2));
    expect(ai.keys).toContain(heatKeyOf(NODE, 'rotation', 2));
    expect(ai.keys).not.toContain(heatKeyOf(NODE, 'opacity', 1));
  });

  it('re-baselining "save" forgets what came before it', () => {
    key('opacity', 0, 0);
    markHeatSaved();
    key('opacity', 1, 100);
    expect(heatFor('save').keys.size).toBeGreaterThan(0);

    markHeatSaved();
    expect(heatFor('save').keys.size).toBe(0);
  });
});

describe('isKeyframeHot', () => {
  it('matches a plain property by its model id', () => {
    key('opacity', 0, 0);
    markHeatSaved();
    key('opacity', 1, 100);
    const diff = heatFor('save');
    expect(isKeyframeHot(diff, makeKeyframeId(NODE, 'opacity', 1))).toBe(true);
    expect(isKeyframeHot(diff, makeKeyframeId(NODE, 'opacity', 0))).toBe(false);
  });

  it('matches a MERGED position row, which no engine track is filed under', () => {
    key('x', 0, 0);
    key('y', 0, 0);
    markHeatSaved();
    key('x', 1, 50);
    const diff = heatFor('save');
    // The model's merged Position row carries a pseudo-prop id. A raw set
    // lookup misses every position keyframe an AI run wrote; the expansion is
    // the same one the hover tooltip uses to read those values back.
    expect(isKeyframeHot(diff, makeKeyframeId(NODE, POSITION_PSEUDO_PROP, 1))).toBe(true);
  });

  it('says no for an id that does not parse', () => {
    key('opacity', 0, 0);
    markHeatSaved();
    key('opacity', 1, 100);
    expect(isKeyframeHot(heatFor('save'), 'not-a-keyframe-id')).toBe(false);
  });
});
