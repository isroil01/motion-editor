/**
 * Multi-selection editing — the seam the Properties panel edits N layers
 * through.
 *
 * The four promises under test, because they are the four things a user can
 * SEE go wrong:
 *
 *   1. a row shows `—` when the layers disagree, and a number when they do
 *      not — including when only some layers have the property at all;
 *   2. typing applies to every layer, and `+10` / `*2` are evaluated PER
 *      LAYER (that is the whole point of typing maths into a mixed field);
 *   3. a drag moves every layer by the same delta FROM WHERE IT STARTED, so
 *      the offset cannot compound across pointer events;
 *   4. one gesture is one undo entry, however many layers it touched.
 *
 * (4) is the one that cannot be checked by reading values back, so it is
 * checked by counting the history keys the write path opened.
 */

import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import type { SceneNode } from '@core/types';
import {
  aggregateFlag,
  aggregateProperty,
  applyAbsolute,
  applyFlagAll,
  applyRelative,
  applyTextExpression,
  snapshotStarts,
  selectionKinds,
} from './multiSelection';

/* `batchHistory` is the "one undo entry" mechanism; spying on the KEY it is
 * called with is how a test sees grouping without needing a live history. */
const batchKeys: string[] = [];
jest.mock('@stores/historyStore', () => ({
  batchHistory: (key: string, fn: () => void) => {
    batchKeys.push(key);
    fn();
  },
}));

const IDS = ['ms_a', 'ms_b', 'ms_c'];

function addNode(id: string, x: number, opacity: number): void {
  defaultSceneGraph.addNode({
    id,
    name: id,
    parent: null,
    children: [],
    visible: true,
    locked: false,
    transform: { position: { x, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: [
      {
        id: `${id}_t`,
        type: 'Transform',
        props: { [SCENE_KIND_PROP]: 'shape', x, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity },
      },
    ],
  } as unknown as SceneNode);
}

beforeEach(() => {
  batchKeys.length = 0;
  for (const id of IDS) defaultSceneGraph.removeNode?.(id);
  addNode('ms_a', 100, 100);
  addNode('ms_b', 200, 100);
  addNode('ms_c', 300, 50);
});

afterAll(() => {
  for (const id of IDS) defaultSceneGraph.removeNode?.(id);
});

describe('aggregateProperty', () => {
  it('reports the primary value and no mixing when the layers agree', () => {
    const agg = aggregateProperty(['ms_a', 'ms_b'], 'opacity', 0);
    expect(agg.mixed).toBe(false);
    expect(agg.value).toBe(100);
    expect(agg.present).toBe(2);
  });

  it('reports mixed when any layer disagrees, still showing the PRIMARY value', () => {
    const agg = aggregateProperty(['ms_a', 'ms_c'], 'opacity', 0);
    expect(agg.mixed).toBe(true);
    // The field shows the primary's number under the `—`, so a subsequent
    // absolute type-in has a sane starting point.
    expect(agg.value).toBe(100);
  });

  it('counts only the layers that HAVE the property — the "N of M" hint', () => {
    const agg = aggregateProperty(['ms_a', 'ms_b', 'ghost_node'], 'x', 0);
    expect(agg.present).toBe(2);
    expect(agg.nodeIds).toEqual(['ms_a', 'ms_b']);
  });

  it('is not animated when nothing is keyframed', () => {
    const agg = aggregateProperty(IDS, 'x', 0);
    expect(agg.animated).toBe(false);
    expect(agg.allAnimated).toBe(false);
  });

  it('falls back to the property default when no layer can supply a value', () => {
    const agg = aggregateProperty(['ghost_one', 'ghost_two'], 'opacity', 0);
    expect(agg.present).toBe(0);
    expect(Number.isFinite(agg.value)).toBe(true);
  });
});

describe('applyAbsolute', () => {
  it('sets every layer to the same value in ONE history entry', () => {
    applyAbsolute(IDS, 'x', 42, { compTime: 0, label: 'Set X' });
    expect(aggregateProperty(IDS, 'x', 0)).toMatchObject({ value: 42, mixed: false });
    expect(new Set(batchKeys).size).toBe(1);
  });

  it('coalesces a whole drag onto one key when the caller supplies a mergeKey', () => {
    for (const v of [10, 20, 30]) {
      applyAbsolute(IDS, 'x', v, { compTime: 0, mergeKey: 'drag-x', label: 'Set X' });
    }
    expect(new Set(batchKeys)).toEqual(new Set(['drag-x']));
  });

  it('skips layers that do not exist rather than throwing', () => {
    applyAbsolute(['ms_a', 'nope'], 'x', 7, { compTime: 0 });
    expect(aggregateProperty(['ms_a'], 'x', 0).value).toBe(7);
  });
});

describe('applyRelative — a scrub is a delta from the START', () => {
  it('moves every layer by the same amount, preserving the differences', () => {
    const starts = snapshotStarts(IDS, 'x', 0);
    applyRelative('x', starts, 25, { compTime: 0, label: 'Offset X' });
    expect(aggregateProperty(['ms_a'], 'x', 0).value).toBe(125);
    expect(aggregateProperty(['ms_b'], 'x', 0).value).toBe(225);
    expect(aggregateProperty(['ms_c'], 'x', 0).value).toBe(325);
  });

  it('does not compound: two moves from the SAME snapshot land at the second delta', () => {
    const starts = snapshotStarts(IDS, 'x', 0);
    applyRelative('x', starts, 25, { compTime: 0, mergeKey: 'drag' });
    applyRelative('x', starts, 40, { compTime: 0, mergeKey: 'drag' });
    expect(aggregateProperty(['ms_a'], 'x', 0).value).toBe(140);
  });

  it('clamps to the caller`s bounds', () => {
    const starts = snapshotStarts(IDS, 'opacity', 0);
    applyRelative('opacity', starts, 500, { compTime: 0, min: 0, max: 100 });
    expect(aggregateProperty(IDS, 'opacity', 0)).toMatchObject({ value: 100, mixed: false });
  });

  it('is one history entry for the whole gesture', () => {
    const starts = snapshotStarts(IDS, 'x', 0);
    for (const d of [5, 10, 15]) applyRelative('x', starts, d, { compTime: 0, mergeKey: 'scrub-x' });
    expect(new Set(batchKeys)).toEqual(new Set(['scrub-x']));
  });
});

describe('applyTextExpression — maths is evaluated PER LAYER', () => {
  it('`+10` adds ten to each layer`s own value', () => {
    expect(applyTextExpression(IDS, 'x', '+10', { compTime: 0 })).toBe(true);
    expect(aggregateProperty(['ms_a'], 'x', 0).value).toBe(110);
    expect(aggregateProperty(['ms_b'], 'x', 0).value).toBe(210);
    expect(aggregateProperty(['ms_c'], 'x', 0).value).toBe(310);
  });

  it('`*2` doubles each layer`s own value', () => {
    expect(applyTextExpression(IDS, 'x', '*2', { compTime: 0 })).toBe(true);
    expect(aggregateProperty(['ms_b'], 'x', 0).value).toBe(400);
  });

  it('a bare number sets every layer to it and clears the mixing', () => {
    expect(applyTextExpression(IDS, 'opacity', '75', { compTime: 0 })).toBe(true);
    expect(aggregateProperty(IDS, 'opacity', 0)).toMatchObject({ value: 75, mixed: false });
  });

  it('refuses unparsable text and leaves every value alone', () => {
    expect(applyTextExpression(IDS, 'x', 'wat', { compTime: 0 })).toBe(false);
    expect(aggregateProperty(['ms_a'], 'x', 0).value).toBe(100);
    expect(aggregateProperty(['ms_c'], 'x', 0).value).toBe(300);
  });
});

describe('flags — the layer switches', () => {
  it('agrees when every layer agrees', () => {
    const agg = aggregateFlag(IDS, () => true);
    expect(agg).toMatchObject({ value: true, mixed: false, present: 3 });
  });

  it('reports mixed on the first disagreement, keeping the PRIMARY value', () => {
    const agg = aggregateFlag(IDS, (id) => id === 'ms_a');
    expect(agg.value).toBe(true);
    expect(agg.mixed).toBe(true);
  });

  it('ignores ids that are not in the scene', () => {
    expect(aggregateFlag(['ms_a', 'ghost'], () => 'draft').present).toBe(1);
  });

  it('writes every live layer under ONE history entry', () => {
    const touched: string[] = [];
    expect(applyFlagAll([...IDS, 'ghost'], 'Draft Quality', (id) => touched.push(id))).toBe(3);
    expect(touched).toEqual(IDS);
    expect(new Set(batchKeys).size).toBe(1);
  });
});

describe('selectionKinds — the header breakdown', () => {
  it('counts the selection by layer kind', () => {
    expect(selectionKinds(IDS)).toEqual([{ kind: 'shape', count: 3 }]);
  });

  it('has nothing to say about an empty selection', () => {
    expect(selectionKinds([])).toEqual([]);
  });
});
