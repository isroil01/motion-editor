/**
 * Rendering through a NAMED camera (`camera3dMode: 'camera:<id>'`).
 *
 * The active-camera rule picks the topmost camera, so a lower camera could only
 * be seen by restacking the comp. A camera view must render exactly what that
 * restack would — same projection, same everything — and a view naming a
 * camera that is gone must render the ordinary Active Camera frame, never a
 * blank or default-camera one.
 */

import { buildSnapshot } from './buildSnapshot';
import SceneGraph from '@core/scene/SceneGraph';
import { AnimationEngine } from '@motion/animation';
import type { SceneNode } from '@core/types';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';

const W = 1920;
const H = 1080;
const FOCAL = 2666.5025797583758;

function node(id: string, kind: string, parent: string | null, props: Record<string, unknown>): SceneNode {
  return {
    id, name: id, parent, children: [], visible: true, locked: false,
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: [
      { id: `${id}_t`, type: 'Transform', props: { [SCENE_KIND_PROP]: kind, x: 0, y: 0, rotation: 0, ...props } },
      { id: `${id}_s`, type: 'Style', props: { opacity: 100, fill: '#2b7eff' } },
    ],
  } as unknown as SceneNode;
}

/**
 * A 3D shape at the comp centre and two cameras: one framed on centre, one
 * panned 400px right. `order` is paint order (back → front), so its LAST entry
 * is the active camera.
 */
function comp(order: Array<'centre' | 'panned'>): SceneGraph {
  const g = new SceneGraph();
  g.addNode(node('root', 'group', null, {}));
  g.addChild('root', node('deep', 'shape', 'root', {
    x: W / 2, y: H / 2, width: 300, height: 300, z: 0, rotationX: 0, rotationY: 0,
  }));
  for (const which of order) {
    const x = which === 'centre' ? W / 2 : W / 2 + 400;
    g.addChild('root', node(which, 'camera', 'root', { x, y: H / 2, z: -FOCAL, focalLength: FOCAL }));
  }
  return g;
}

function deepX(g: SceneGraph, camera3dMode?: string): number | undefined {
  const snap = buildSnapshot(g, new AnimationEngine(), 0, undefined, undefined, undefined, undefined, {
    width: W, height: H, background: '#101014', rootId: 'root',
    ...(camera3dMode ? { camera3dMode } : {}),
  } as never);
  return snap.layers.find((l) => l.id === 'deep')?.x;
}

describe('rendering through a named camera', () => {
  it('looks through the lower camera exactly as if it were restacked on top', () => {
    // `centre` is on top, so Active Camera sees the shape where it is …
    const active = deepX(comp(['panned', 'centre']));
    // … and the panned camera, only reachable by name, slides it left.
    const viaPanned = deepX(comp(['panned', 'centre']), 'camera:panned');
    const restacked = deepX(comp(['centre', 'panned']));

    expect(active).toBeDefined();
    expect(viaPanned).toBeDefined();
    expect(viaPanned).not.toBeCloseTo(active!, 1);
    expect(viaPanned).toBeCloseTo(restacked!, 6);
  });

  it('naming the topmost camera is the same frame as Active Camera', () => {
    const g = comp(['panned', 'centre']);
    expect(deepX(g, 'camera:centre')).toBeCloseTo(deepX(g, 'active')!, 6);
  });

  it('a stale camera view renders the Active Camera frame', () => {
    const g = comp(['panned', 'centre']);
    expect(deepX(g, 'camera:deleted')).toBeCloseTo(deepX(g, 'active')!, 6);
  });
});
