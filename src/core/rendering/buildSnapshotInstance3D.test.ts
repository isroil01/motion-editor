/**
 * A composition LAYER can be a 3D layer (AE): its composition renders flat, as
 * a card, and the card sits in the host's 3D space — projected through the
 * host camera onto a real perspective quad and depth-sorted with the other 3D
 * layers. A COLLAPSED comp layer is not a card (its layers splice into the
 * host), so it keeps the switch off, as before.
 */

import { buildSnapshot } from './buildSnapshot';
import { precompNeedsIsolation } from './snapshotToFrameScene';
import SceneGraph from '@core/scene/SceneGraph';
import { AnimationEngine } from '@motion/animation';
import type { SceneNode } from '@core/types';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { COMP_REF_PROP, COMP_COLLAPSE_PROP } from '@core/scene/compInstance';
import { canBe3D } from '@core/scene/threeD';

const IDENTITY = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } };

function root(id: string): SceneNode {
  return {
    id, name: id, parent: null, children: [], visible: true, locked: false, transform: IDENTITY,
    components: [{ id: `${id}_m`, type: 'group', props: { [SCENE_KIND_PROP]: 'group' } }],
  } as unknown as SceneNode;
}

function instanceNode(threeD: Record<string, number> | null, collapsed = false): SceneNode {
  return {
    id: 'inst', name: 'inst', parent: null, children: [], visible: true, locked: false, transform: IDENTITY,
    components: [
      {
        id: 'inst_t',
        type: 'Transform',
        props: { [SCENE_KIND_PROP]: 'comp', x: 400, y: 300, width: 400, height: 300, ...(threeD ?? {}) },
      },
      { id: 'inst_fx', type: 'fx', props: { precomp: true, [COMP_REF_PROP]: 'B', ...(collapsed ? { [COMP_COLLAPSE_PROP]: true } : {}) } },
    ],
  } as unknown as SceneNode;
}

function container(threeD: Record<string, number> | null) {
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
  g.addChild('A', instanceNode(threeD) as never);
  return buildSnapshot(g, new AnimationEngine(), 0, undefined, undefined, undefined, undefined, {
    width: 800, height: 600, background: '#000000', rootId: 'A',
    compSizeOf: (id) => (id === 'B' ? { width: 400, height: 300 } : undefined),
  }).layers.find((l) => l.id === 'inst');
}

/** [TL, TR, BR, BL] corners of a quad3d as points. */
function corners(q: readonly number[]): Array<{ x: number; y: number }> {
  return [0, 2, 4, 6].map((i) => ({ x: q[i]!, y: q[i + 1]! }));
}

describe('3D composition layers', () => {
  it('lets a sealed comp layer take the 3D switch — not a collapsed one', () => {
    expect(canBe3D(instanceNode(null))).toBe(true);
    expect(canBe3D(instanceNode(null, true))).toBe(false);
  });

  it('projects an unrotated card at z 0 onto its flat box', () => {
    const c = container({ z: 0 })!;
    expect(c.quad3d).toBeDefined();
    const [tl, tr, br, bl] = corners(c.quad3d!);
    // 400×300 centred on (400, 300): the comp plane projects 1:1.
    expect(tl!.x).toBeCloseTo(200, 0); expect(tl!.y).toBeCloseTo(150, 0);
    expect(tr!.x).toBeCloseTo(600, 0); expect(tr!.y).toBeCloseTo(150, 0);
    expect(br!.x).toBeCloseTo(600, 0); expect(br!.y).toBeCloseTo(450, 0);
    expect(bl!.x).toBeCloseTo(200, 0); expect(bl!.y).toBeCloseTo(450, 0);
    expect(typeof c.depth).toBe('number');
    // The card composites as one unit, drawn flat and then projected.
    expect(precompNeedsIsolation(c)).toBe(true);
  });

  it('tilts into real perspective when rotated in Y — the near edge is taller', () => {
    const [tl, tr, br, bl] = corners(container({ z: 0, rotationY: 60 })!.quad3d!);
    const leftH = bl!.y - tl!.y;
    const rightH = br!.y - tr!.y;
    expect(Math.abs(leftH - rightH)).toBeGreaterThan(1);
    // And narrower than the flat 400 px card.
    expect(Math.abs(tr!.x - tl!.x)).toBeLessThan(400);
  });

  it('shrinks as it moves away from the camera', () => {
    const [tl, tr] = corners(container({ z: 1500 })!.quad3d!);
    expect(tr!.x - tl!.x).toBeLessThan(400);
  });

  it('leaves a 2D comp layer exactly as before', () => {
    const c = container(null)!;
    expect(c.quad3d).toBeUndefined();
    expect(c.x).toBe(400);
    expect(c.y).toBe(300);
  });
});
