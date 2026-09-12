/**
 * Motion blur on a composition LAYER (AE): the placed comp smears along its own
 * motion as one card, behind the same gate as any layer — the comp's motion
 * blur switch AND the layer's, and only when it moves.
 *
 * The sealed container used to get no shutter samples at all, so a moving
 * precomp with motion blur on stayed sharp while every other layer blurred.
 */

import { buildSnapshot } from './buildSnapshot';
import { precompNeedsIsolation } from './snapshotToFrameScene';
import SceneGraph from '@core/scene/SceneGraph';
import { AnimationEngine } from '@motion/animation';
import type { SceneNode } from '@core/types';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { COMP_REF_PROP } from '@core/scene/compInstance';

const IDENTITY = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } };

const BLUR = { enabled: true, shutterAngle: 180, shutterPhase: -90, samples: 8, adaptiveSampleLimit: 16, fps: 30 };

function root(id: string): SceneNode {
  return {
    id, name: id, parent: null, children: [], visible: true, locked: false, transform: IDENTITY,
    components: [{ id: `${id}_m`, type: 'group', props: { [SCENE_KIND_PROP]: 'group' } }],
  } as unknown as SceneNode;
}

function scene(layerBlur: boolean): SceneGraph {
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
  g.addChild('A', {
    id: 'inst', name: 'inst', parent: null, children: [], visible: true, locked: false, transform: IDENTITY,
    components: [
      { id: 'inst_t', type: 'Transform', props: { [SCENE_KIND_PROP]: 'comp', x: 400, y: 300, width: 400, height: 300 } },
      { id: 'inst_fx', type: 'fx', props: { precomp: true, [COMP_REF_PROP]: 'B', ...(layerBlur ? { motionBlur: true } : {}) } },
    ],
  } as never);
  return g;
}

function container(opts: { layerBlur: boolean; compBlur: boolean; moving: boolean }) {
  const anim = new AnimationEngine();
  if (opts.moving) {
    // 300 px/s to the right.
    anim.setKeyframes('inst', 'x', [{ t: 0, value: 250, easing: 'linear' }, { t: 1, value: 550, easing: 'linear' }] as never);
  }
  const snap = buildSnapshot(scene(opts.layerBlur), anim, 0.5, undefined, undefined, undefined,
    opts.compBlur ? BLUR : undefined,
    {
      width: 800, height: 600, background: '#000000', rootId: 'A',
      compSizeOf: (id) => (id === 'B' ? { width: 400, height: 300 } : undefined),
    });
  return snap.layers.find((l) => l.id === 'inst')!;
}

describe('buildSnapshot — comp layer motion blur', () => {
  it('samples the moving card across the shutter, in world pose, around where it is now', () => {
    const c = container({ layerBlur: true, compBlur: true, moving: true });
    expect(c.precompLayers?.length).toBeGreaterThan(0);
    const xs = (c.motionSamples ?? []).map((s) => s.x);
    expect(xs.length).toBeGreaterThan(1);
    // A 180° shutter centred on the frame spans half a frame of travel
    // (300 px/s ÷ 30 fps ÷ 2 = 5 px) around the current x.
    expect(Math.min(...xs)).toBeLessThan(c.x);
    expect(Math.max(...xs)).toBeGreaterThan(c.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(10);
    // Such a container cannot be collapsed inline — its samples would be lost.
    expect(precompNeedsIsolation(c)).toBe(true);
  });

  it('stays sharp without both switches, or when it does not move', () => {
    expect(container({ layerBlur: false, compBlur: true, moving: true }).motionSamples).toBeUndefined();
    expect(container({ layerBlur: true, compBlur: false, moving: true }).motionSamples).toBeUndefined();
    expect(container({ layerBlur: true, compBlur: true, moving: false }).motionSamples).toBeUndefined();
  });
});
