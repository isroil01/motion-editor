/**
 * What an extruded solid's WALLS carry, beyond a flat colour.
 *
 * Three reports, all the same shape of bug — the front face got the treatment
 * and the body did not, split exactly along the front edge:
 *   • a GRADIENT fill painted the caps and left the walls the base colour,
 *     because `layer.fill` is the base a gradient never writes to and a mesh
 *     range is one colour. The walls now sample a paint plate.
 *   • INTERIOR layer styles (inner shadow / glow / satin / bevel / stroke)
 *     reached the front only; they need a per-face resolve, so a layer that
 *     asks for one takes the quad path that stages it.
 *   • the mesh CARRIER did not declare itself a shadow caster, so the GPU
 *     shadow map saw the flat front plane and the solid threw a zero-depth
 *     silhouette.
 */
import { buildSnapshot } from './buildSnapshot';
import SceneGraph from '@core/scene/SceneGraph';
import { AnimationEngine } from '@motion/animation';
import type { SceneNode } from '@core/types';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { clearExtrusionMeshCaches } from '@core/scene/extrusionMesh';
import { snapshotToFrameScene } from './snapshotToFrameScene';

const COMP = { width: 800, height: 600, background: '#101014' };

function box(id: string, t: Record<string, unknown> = {}, fx: Record<string, unknown> = {}): SceneNode {
  return {
    id, name: id, parent: null, children: [], visible: true, locked: false,
    transform: { position: { x: 400, y: 300 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: [
      { id: `${id}_t`, type: 'Transform', props: { [SCENE_KIND_PROP]: 'shape', x: 400, y: 300, rotation: 0, width: 120, height: 80, z: 0, extrusionDepth: 50, ...t } },
      { id: `${id}_s`, type: 'Style', props: { opacity: 100, fill: '#2b7eff' } },
      // Gradients and layer styles both live on the fx component.
      ...(Object.keys(fx).length > 0 ? [{ id: `${id}_fx`, type: 'fx', props: fx }] : []),
    ],
  } as unknown as SceneNode;
}

const snap = (g: SceneGraph) => buildSnapshot(g, new AnimationEngine(), 0, undefined, undefined, undefined, undefined, COMP);
const meshOf = (g: SceneGraph, id = 'b') => snap(g).layers.find((l) => l.id === `${id}::ext-mesh`);

const GRADIENT = {
  type: 'linear',
  angle: 90,
  stops: [{ offset: 0, color: '#ff0000' }, { offset: 1, color: '#0000ff' }],
};

beforeEach(() => clearExtrusionMeshCaches());

describe('extruded walls — gradient fill', () => {
  it('a solid fill keeps flat wall colours and needs no plate', () => {
    const g = new SceneGraph();
    g.addNode(box('b'));
    const mesh = meshOf(g)!.extrudedMesh!;
    expect(mesh.paint).toBeUndefined();
    expect(mesh.ranges.every((r) => !r.paintTextured)).toBe(true);
  });

  it('a gradient fill hands every derived face the paint plate', () => {
    const g = new SceneGraph();
    g.addNode(box('b', {}, { fill: GRADIENT }));
    const mesh = meshOf(g)!.extrudedMesh!;
    expect(mesh.paint).toMatchObject({ key: 'paint:b', width: 120, height: 80 });
    expect(mesh.paint!.fillPaint).toEqual(GRADIENT);
    // Every range of a shape body is derived from the fill, so all of them.
    expect(mesh.ranges.length).toBeGreaterThan(0);
    expect(mesh.ranges.every((r) => r.paintTextured)).toBe(true);
  });

  it('an explicit per-face colour wins over the gradient on that face', () => {
    const g = new SceneGraph();
    g.addNode(box('b', { faceMaterials: { side: { fill: '#00ff00' } } }, { fill: GRADIENT }));
    const mesh = meshOf(g)!.extrudedMesh!;
    const side = mesh.ranges.find((r) => r.role === 'side');
    if (side) {
      expect(side.paintTextured).toBeUndefined();
      expect(side.fill).toBe('#00ff00');
    }
    // The faces nobody overrode still take the gradient.
    expect(mesh.ranges.some((r) => r.paintTextured)).toBe(true);
  });
});

describe('extruded walls — interior layer styles', () => {
  it('an inner shadow sends the object to the per-face path, which can resolve it', () => {
    const g = new SceneGraph();
    g.addNode(box('b', {}, { layerStyles: { innerShadow: { enabled: true, color: '#000000', opacity: 0.5, distance: 4, size: 8, angle: 120 } } }));
    const ids = snap(g).layers.map((l) => l.id);
    expect(ids).not.toContain('b::ext-mesh');
    // …and a body is still drawn: the quad faces, which carry the style.
    expect(ids.some((id) => id.startsWith('b::ext-'))).toBe(true);
  });

  it('an untouched layer keeps the mesh (control for the case above)', () => {
    const g = new SceneGraph();
    g.addNode(box('b'));
    expect(snap(g).layers.map((l) => l.id)).toContain('b::ext-mesh');
  });
});

describe('extruded solid — cast shadows', () => {
  it('the mesh carrier casts, so the shadow map sees the solid and not the front plane', () => {
    const g = new SceneGraph();
    g.addNode(box('b', { castsShadows: true }));
    const mesh = meshOf(g);
    expect(mesh?.extrudedMesh).toBeDefined();
    expect(mesh?.castsShadow3d).toBe(true);
  });
});

describe('extruded walls — colour effects reach a gradient wall', () => {
  // Gradient walls sample the paint plate, whose texels are ungraded, while a
  // solid wall's colour is graded on the CPU. So only the gradient carrier
  // needs the renderable-level grade — and a solid one must not get it, or its
  // walls would be graded twice wherever a texture is sampled.
  const INVERT = { id: 'fx_inv', type: 'invert', params: { amount: 100 } };
  const LEVELS = { id: 'fx_lv', type: 'levels', params: { inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 128 } };
  const carrier = (g: SceneGraph) => snapshotToFrameScene(snap(g)).renderables.find((r) => r.id === 'b::ext-mesh');

  it('a gradient extrusion carries the colour matrix and the LUT strip key to its plate', () => {
    const g = new SceneGraph();
    g.addNode(box('b', {}, { fill: GRADIENT, effects: [INVERT, LEVELS] }));
    const r = carrier(g)!;
    expect(r.extrudedMesh!.ranges.some((x) => x.textured && x.textureKey === 'paint:b')).toBe(true);
    expect(r.colorMatrix).toBeDefined();
    expect(r.lutTextureKey).toBe('lut:b::ext-mesh');
  });

  it('a solid extrusion does not — its walls are already graded on the CPU', () => {
    const g = new SceneGraph();
    g.addNode(box('b', {}, { effects: [INVERT, LEVELS] }));
    const r = carrier(g)!;
    expect(r.extrudedMesh).toBeDefined();
    expect(r.colorMatrix).toBeUndefined();
    expect(r.lutTextureKey).toBeUndefined();
  });
});
