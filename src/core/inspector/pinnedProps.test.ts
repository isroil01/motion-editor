/**
 * Pinned properties live IN THE DOCUMENT (`__pinnedProps`), beside the
 * Essential Properties bag and for the same reason: which of a rig's forty
 * properties matter is a fact about the project, not about the person who
 * opened it. These tests pin the storage decision (it is on a component, so
 * undo and serialisation get it for free), the ordering (pins keep the order
 * they were pinned in — it is a hand-built shortlist, not a set), and the
 * rule that makes the tab appear and disappear.
 */

import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import type { SceneNode } from '@core/types';
import {
  PINNED_PROPS,
  hasPinnedSection,
  isPinnedProp,
  pinnedEntriesFor,
  readPinnedProps,
  setPinnedProp,
  togglePinnedProp,
} from './pinnedProps';

const NODE = 'pin_node';

function addNode(): void {
  defaultSceneGraph.addNode({
    id: NODE,
    name: NODE,
    parent: null,
    children: [],
    visible: true,
    locked: false,
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: [
      {
        id: `${NODE}_t`,
        type: 'Transform',
        props: { [SCENE_KIND_PROP]: 'shape', x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, opacity: 100 },
      },
    ],
  } as unknown as SceneNode);
}

beforeEach(() => {
  defaultSceneGraph.removeNode?.(NODE);
  addNode();
});

afterAll(() => {
  defaultSceneGraph.removeNode?.(NODE);
});

describe('reading', () => {
  it('is empty on a fresh layer, so the tab does not exist', () => {
    expect(readPinnedProps(NODE)).toEqual([]);
    expect(hasPinnedSection(NODE)).toBe(false);
  });

  it('is empty for a layer that is not in the scene', () => {
    expect(readPinnedProps('ghost')).toEqual([]);
    expect(hasPinnedSection('ghost')).toBe(false);
  });
});

describe('pinning', () => {
  it('adds the property and makes the tab appear', () => {
    expect(setPinnedProp(NODE, 'opacity', true)).toBe(true);
    expect(isPinnedProp(NODE, 'opacity')).toBe(true);
    expect(hasPinnedSection(NODE)).toBe(true);
  });

  it('stores the list on a component, where undo and serialisation see it', () => {
    setPinnedProp(NODE, 'x', true);
    const node = defaultSceneGraph.getNode(NODE)!;
    const bag = node.components
      .map((c) => (c.props as Record<string, unknown>)[PINNED_PROPS])
      .find(Array.isArray);
    expect(bag).toEqual(['x']);
  });

  it('keeps the order things were pinned in — it is a shortlist, not a set', () => {
    setPinnedProp(NODE, 'rotation', true);
    setPinnedProp(NODE, 'x', true);
    setPinnedProp(NODE, 'opacity', true);
    expect(readPinnedProps(NODE)).toEqual(['rotation', 'x', 'opacity']);
  });

  it('is idempotent — pinning twice does not duplicate the row', () => {
    setPinnedProp(NODE, 'x', true);
    setPinnedProp(NODE, 'x', true);
    expect(readPinnedProps(NODE)).toEqual(['x']);
  });

  it('unpins, and the tab goes away when the list empties', () => {
    setPinnedProp(NODE, 'x', true);
    setPinnedProp(NODE, 'x', false);
    expect(readPinnedProps(NODE)).toEqual([]);
    expect(hasPinnedSection(NODE)).toBe(false);
  });

  it('toggles', () => {
    togglePinnedProp(NODE, 'scaleX');
    expect(isPinnedProp(NODE, 'scaleX')).toBe(true);
    togglePinnedProp(NODE, 'scaleX');
    expect(isPinnedProp(NODE, 'scaleX')).toBe(false);
  });

  it('refuses a layer that cannot hold the list rather than pretending', () => {
    expect(setPinnedProp('ghost', 'x', true)).toBe(false);
  });
});

describe('pinnedEntriesFor', () => {
  it('lists each pin once, marked as a hand pin', () => {
    setPinnedProp(NODE, 'x', true);
    setPinnedProp(NODE, 'opacity', true);
    expect(pinnedEntriesFor(NODE)).toEqual([
      { prop: 'x', pinned: true, essential: false },
      { prop: 'opacity', pinned: true, essential: false },
    ]);
  });

  it('has nothing to list for a layer with no pins and no essentials', () => {
    expect(pinnedEntriesFor(NODE)).toEqual([]);
  });
});
