/**
 * `layerView` — After Effects' Layer panel: one layer alone, before its
 * transform, at its own size; drawn with its eye off and outside its In/Out;
 * "Render" off drops its masks and effects.
 */

import { buildSnapshot } from './buildSnapshot';
import SceneGraph from '@core/scene/SceneGraph';
import { AnimationEngine } from '@motion/animation';
import type { SceneNode } from '@core/types';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';

function node(id: string, components: SceneNode['components'], extra: Record<string, unknown> = {}): SceneNode {
  return {
    id, name: id, parent: null, children: [], visible: true, locked: false,
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    components,
    ...extra,
  } as unknown as SceneNode;
}

const MASK = {
  paths: [{
    id: 'm1', mode: 'add', closed: true, feather: 0, opacity: 1, expansion: 0, inverted: false,
    points: [[-10, -5], [10, -5], [10, 5], [-10, 5]].map(([x, y]) => ({ x, y, inX: x, inY: y, outX: x, outY: y })),
  }],
};

/** A transformed layer L inside a transformed group G, with a child K parented to L. */
function scene(opts: { hidden?: boolean } = {}): SceneGraph {
  const g = new SceneGraph();
  g.addNode(node('G', [
    { id: 'G_t', type: 'Transform', props: { [SCENE_KIND_PROP]: 'group', x: 300, y: 200, rotation: 45 } },
    { id: 'G_m', type: 'group', props: { [SCENE_KIND_PROP]: 'group' } },
  ]));
  g.addChild('G', node('L', [
    { id: 'L_t', type: 'Transform', props: { [SCENE_KIND_PROP]: 'shape', x: 100, y: 50, rotation: 30, scaleX: 2, scaleY: 3, width: 40, height: 20 } },
    { id: 'L_s', type: 'Style', props: { opacity: 50, fill: '#ffffff' } },
    { id: 'L_fx', type: 'fx', props: { blendMode: 'multiply', mask: MASK } },
  ], opts.hidden ? { visible: false } : {}) as never);
  g.addChild('L', node('K', [
    { id: 'K_t', type: 'Transform', props: { [SCENE_KIND_PROP]: 'shape', x: 5, y: 5, width: 4, height: 4 } },
    { id: 'K_s', type: 'Style', props: { opacity: 100, fill: '#000000' } },
  ]) as never);
  return g;
}

function layerView(g: SceneGraph, render = true) {
  return buildSnapshot(g, new AnimationEngine(), 0, undefined, undefined, undefined, undefined, {
    width: 40, height: 20, background: '#000000', transparent: true,
    rootId: 'L', layerView: { id: 'L', render },
  }).layers;
}

describe('buildSnapshot — layerView (AE Layer panel)', () => {
  it('draws the one layer centred in its own frame, untransformed, at full opacity', () => {
    const layers = layerView(scene());
    // Not its parent, not the layer parented to it.
    expect(layers.map((l) => l.id)).toEqual(['L']);
    const l = layers[0]!;
    expect(l).toMatchObject({ x: 20, y: 10, rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, blend: 'normal', width: 40, height: 20 });
    expect(l.matrix).toBeUndefined();
    expect(l.mask).toBeDefined();
  });

  it('shows the layer with its eye off', () => {
    const layers = layerView(scene({ hidden: true }));
    expect(layers).toHaveLength(1);
    expect(layers[0]!.visible).not.toBe(false);
  });

  it('drops masks and effects when Render is off', () => {
    const l = layerView(scene(), false)[0]!;
    expect(l.mask).toBeUndefined();
    expect(l.effects).toBeUndefined();
  });

  it('leaves the ordinary comp render alone', () => {
    const layers = buildSnapshot(scene(), new AnimationEngine(), 0, undefined, undefined, undefined, undefined, {
      width: 800, height: 600, background: '#000000', rootId: 'G',
    }).layers;
    const l = layers.find((x) => x.id === 'L')!;
    expect(l.opacity).toBeCloseTo(0.5);
    expect(l.x === 20 && l.y === 10 && l.rotation === 0).toBe(false);
    expect(layers.some((x) => x.id === 'K')).toBe(true);
  });
});
