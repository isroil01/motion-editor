/**
 * A composition LAYER turns around its own anchor point, like any layer (AE).
 *
 * The sealed container used to be emitted without `anchorX/Y`, so a placed
 * comp always rotated and scaled around its centre — while its selection
 * outline, which applies the anchor, turned around the anchor.
 */

import { buildSnapshot } from './buildSnapshot';
import SceneGraph from '@core/scene/SceneGraph';
import { AnimationEngine } from '@motion/animation';
import type { SceneNode } from '@core/types';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { COMP_REF_PROP } from '@core/scene/compInstance';

const IDENTITY = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } };

function root(id: string): SceneNode {
  return {
    id, name: id, parent: null, children: [], visible: true, locked: false, transform: IDENTITY,
    components: [{ id: `${id}_m`, type: 'group', props: { [SCENE_KIND_PROP]: 'group' } }],
  } as unknown as SceneNode;
}

function instance(anchor: { x: number; y: number }): SceneNode {
  return {
    id: 'inst', name: 'inst', parent: null, children: [], visible: true, locked: false, transform: IDENTITY,
    components: [
      {
        id: 'inst_t',
        type: 'Transform',
        props: { [SCENE_KIND_PROP]: 'comp', x: 400, y: 300, width: 400, height: 300, anchorX: anchor.x, anchorY: anchor.y },
      },
      { id: 'inst_fx', type: 'fx', props: { precomp: true, [COMP_REF_PROP]: 'B' } },
    ],
  } as unknown as SceneNode;
}

function container(anchor: { x: number; y: number }) {
  const g = new SceneGraph();
  g.addNode(root('A'));
  g.addNode(root('B'));
  g.addChild('B', {
    id: 'box', name: 'box', parent: 'B', children: [], visible: true, locked: false, transform: IDENTITY,
    components: [
      { id: 'box_t', type: 'Transform', props: { [SCENE_KIND_PROP]: 'shape', x: 200, y: 150, width: 50, height: 50 } },
      { id: 'box_s', type: 'Style', props: { opacity: 100, fill: '#ffffff' } },
    ],
  } as never);
  g.addChild('A', instance(anchor) as never);
  const layers = buildSnapshot(g, new AnimationEngine(), 0, undefined, undefined, undefined, undefined, {
    width: 800, height: 600, background: '#000000', rootId: 'A',
    compSizeOf: (id) => (id === 'B' ? { width: 400, height: 300 } : undefined),
  }).layers;
  return layers.find((l) => l.id === 'inst')!;
}

describe('buildSnapshot — comp layer anchor point', () => {
  it('carries the anchor onto the sealed container', () => {
    const c = container({ x: 100, y: -50 });
    expect(c.precompLayers?.length).toBeGreaterThan(0);
    expect(c.anchorX).toBe(100);
    expect(c.anchorY).toBe(-50);
  });

  it('emits no anchor for a centred comp layer (unchanged output)', () => {
    const c = container({ x: 0, y: 0 });
    expect(c.anchorX).toBeUndefined();
    expect(c.anchorY).toBeUndefined();
  });
});
