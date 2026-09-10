/**
 * The MESH extrusion path: a 3D layer with depth becomes ONE `::ext-mesh`
 * carrier layer holding a real solid (walls / bevel / back cap with
 * per-vertex normals), emitted before the front face and routed by the
 * adapter to the renderer's depth-tested mesh path.
 */
import { buildSnapshot } from './buildSnapshot';
import SceneGraph from '@core/scene/SceneGraph';
import { AnimationEngine } from '@motion/animation';
import type { SceneNode } from '@core/types';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { snapshotToFrameScene } from './snapshotToFrameScene';
import { depthEligible3D, Color } from '@motion/renderer';
import { buildChannelLut, sampleChannelLutAsUploaded } from '@core/effects/colorLut';
import type { Effect } from '@core/effects/effects';
import { EXTRUSION_WALL_GAIN, EXTRUSION_BACK_GAIN } from '@core/scene/extrusion';
import { clearExtrusionMeshCaches } from '@core/scene/extrusionMesh';
import { MESH_VERTEX_FLOATS } from '@core/geometry/extrudeMesh';

const COMP = { width: 800, height: 600, background: '#101014' };

function shape3D(id: string, props: Record<string, unknown> = {}, style: Record<string, unknown> = {}): SceneNode {
  return {
    id, name: id, parent: null, children: [], visible: true, locked: false,
    transform: { position: { x: 400, y: 300 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: [
      { id: `${id}_t`, type: 'Transform', props: { [SCENE_KIND_PROP]: 'shape', x: 400, y: 300, rotation: 0, width: 100, height: 60, z: 0, ...props } },
      { id: `${id}_s`, type: 'Style', props: { opacity: 100, fill: '#2b7eff', ...style } },
    ],
  } as unknown as SceneNode;
}

function whiteLight(id: string): SceneNode {
  return {
    id, name: id, parent: null, children: [], visible: true, locked: false,
    transform: { position: { x: 400, y: 300 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: [
      { id: `${id}_t`, type: 'Transform', props: { [SCENE_KIND_PROP]: 'light', x: 400, y: 300, rotation: 0, intensity: 80, radius: 500 } },
      { id: `${id}_s`, type: 'Style', props: { opacity: 100, fill: '#ffffff' } },
    ],
  } as unknown as SceneNode;
}

function snap(graph: SceneGraph, anim = new AnimationEngine(), t = 0) {
  return buildSnapshot(graph, anim, t, undefined, undefined, undefined, undefined, COMP);
}

beforeEach(() => clearExtrusionMeshCaches());

/**
 * A colour LUT (Levels / Curves / …) on an extrusion. It used to BLOCK the
 * mesh path — the gate let only the affine colour effects through — so a Levels
 * swapped the solid for the slice stack. It now rides the carrier: flat ranges
 * are graded through the uploaded table on the CPU, textured ones through the
 * `-lut` mesh materials.
 */
describe('buildSnapshot — colour LUT on the mesh extrusion', () => {
  const LV: Effect = {
    id: 'fx_lv', type: 'levels',
    params: { inputBlack: 25, inputWhite: 210, gamma: 0.8, outputBlack: 0, outputWhite: 255 },
  };
  function withFx(node: SceneNode, effects: unknown[]): SceneNode {
    node.components.push({ id: `${node.id}_fx`, type: 'fx', props: { effects } } as unknown as SceneNode['components'][number]);
    return node;
  }

  it('a Levels keeps the solid on the mesh path and rides the carrier', () => {
    const g = new SceneGraph();
    g.addNode(withFx(shape3D('box', { extrusionDepth: 40 }), [LV]));
    const layers = snap(g).layers;
    expect(layers.map((l) => l.id)).toEqual(['box::ext-mesh', 'box']);
    expect(layers[0]!.effects?.map((e) => e.id)).toEqual(['fx_lv']);
  });

  it('grades every flat range — walls and back cap — and the solid front exactly as the table says', () => {
    const g = new SceneGraph();
    g.addNode(withFx(shape3D('box', { extrusionDepth: 40 }), [LV]));
    const scene = snapshotToFrameScene(snap(g));
    const fill = Color.fromHex('#2b7eff');
    const want = sampleChannelLutAsUploaded(buildChannelLut([LV])!, [fill.r, fill.g, fill.b]);
    // Not vacuous: this Levels visibly moves the fill.
    expect(Math.abs(want[1] - fill.g)).toBeGreaterThan(0.02);

    const body = scene.renderables.find((r) => r.id === 'box::ext-mesh')!;
    expect(body.extrudedMesh!.ranges.length).toBeGreaterThan(1);
    for (const range of body.extrudedMesh!.ranges) {
      expect(range.color.r).toBeCloseTo(want[0], 10);
      expect(range.color.g).toBeCloseTo(want[1], 10);
      expect(range.color.b).toBeCloseTo(want[2], 10);
    }
    // The front face is the layer's own SOLID quad: same table, same colour —
    // no seam along the front edge.
    const front = scene.renderables.find((r) => r.id === 'box')!;
    expect(front.color!.r).toBeCloseTo(want[0], 10);
    expect(front.color!.g).toBeCloseTo(want[1], 10);
    expect(front.color!.b).toBeCloseTo(want[2], 10);
  });

  it('a SPATIAL effect still sends the object to the fallback — only the LUTs were let through', () => {
    const g = new SceneGraph();
    g.addNode(withFx(shape3D('box', { extrusionDepth: 40 }), [LV, { id: 'fx_blur', type: 'blur', params: { amount: 6 } }]));
    expect(snap(g).layers.some((l) => l.extrudedMesh)).toBe(false);
  });
});

describe('buildSnapshot — mesh extrusion', () => {
  it('extrusion > 0 emits ONE mesh carrier immediately before the front face', () => {
    const g = new SceneGraph();
    g.addNode(shape3D('box', { extrusionDepth: 40 }));
    const layers = snap(g).layers;
    expect(layers.map((l) => l.id)).toEqual(['box::ext-mesh', 'box']);
    const body = layers[0]!;
    expect(body.extrudedMesh).toBeDefined();
    expect(body.world3d).toEqual(layers[1]!.world3d);
    expect(body.depth).toBe(layers[1]!.depth);
  });

  it('the mesh is a solid: walls + back cap, vertices in the centred pixel frame', () => {
    const g = new SceneGraph();
    g.addNode(shape3D('box', { extrusionDepth: 40 }));
    const body = snap(g).layers[0]!.extrudedMesh!;
    const roles = body.ranges.map((r) => r.role).sort();
    expect(roles).toEqual(['back', 'side']);
    // x spans ±50, y ±30, z 0..40.
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < body.vertices.length; i += MESH_VERTEX_FLOATS) {
      minX = Math.min(minX, body.vertices[i]!);
      maxX = Math.max(maxX, body.vertices[i]!);
      minZ = Math.min(minZ, body.vertices[i + 2]!);
      maxZ = Math.max(maxZ, body.vertices[i + 2]!);
    }
    expect(minX).toBeCloseTo(-50, 5);
    expect(maxX).toBeCloseTo(50, 5);
    expect(minZ).toBeCloseTo(0, 5);
    expect(maxZ).toBeCloseTo(40, 5);
  });

  it('unlit: walls carry the wall gain, the back cap the back gain, in the layer fill', () => {
    const g = new SceneGraph();
    g.addNode(shape3D('box', { extrusionDepth: 40 }));
    const body = snap(g).layers[0]!;
    expect(body.lighting).toBeUndefined();
    const side = body.extrudedMesh!.ranges.find((r) => r.role === 'side')!;
    const back = body.extrudedMesh!.ranges.find((r) => r.role === 'back')!;
    expect(side.gain).toBe(EXTRUSION_WALL_GAIN);
    expect(back.gain).toBe(EXTRUSION_BACK_GAIN);
    expect(side.fill).toBe('#2b7eff');
    expect(back.fill).toBe('#2b7eff');
  });

  it('per-face materials: explicit colours are used as picked (gain 1)', () => {
    const g = new SceneGraph();
    g.addNode(shape3D('box', { extrusionDepth: 40, bevelDepth: 6, faceMaterials: { side: { fill: '#ff0000' }, back: { fill: '#00ff00' } } }));
    const body = snap(g).layers[0]!.extrudedMesh!;
    const side = body.ranges.find((r) => r.role === 'side')!;
    const back = body.ranges.find((r) => r.role === 'back')!;
    const bevel = body.ranges.find((r) => r.role === 'bevel')!;
    expect(side.fill).toBe('#ff0000');
    expect(side.gain).toBe(1);
    expect(back.fill).toBe('#00ff00');
    expect(back.gain).toBe(1);
    // Bevel not overridden: derived colour, dimmed by its kind's gain.
    expect(bevel.fill).toBe('#2b7eff');
    expect(bevel.gain).toBe(EXTRUSION_WALL_GAIN);
  });

  it('a bevel insets the front face by what the mesh actually applied', () => {
    const g = new SceneGraph();
    g.addNode(shape3D('box', { extrusionDepth: 40, bevelDepth: 5 }));
    const layers = snap(g).layers;
    const front = layers.find((l) => l.id === 'box')!;
    expect(front.width).toBe(90);
    expect(front.height).toBe(50);
    expect(layers[0]!.extrudedMesh!.ranges.some((r) => r.role === 'bevel')).toBe(true);
  });

  it('a rounded rect and an ellipse extrude through the mesh path too', () => {
    const g = new SceneGraph();
    g.addNode(shape3D('rounded', { extrusionDepth: 20, cornerRadius: 12 }));
    g.addNode(shape3D('disc', { extrusionDepth: 20, primitive: 'ellipse' }));
    const ids = snap(g).layers.map((l) => l.id);
    expect(ids).toContain('rounded::ext-mesh');
    expect(ids).toContain('disc::ext-mesh');
    expect(ids.filter((id) => id.includes('::ext-') && !id.endsWith('::ext-mesh'))).toEqual([]);
  });

  it('lit (Accepts Lights + scene light): per-fragment one-sided shade data', () => {
    const g = new SceneGraph();
    g.addNode(whiteLight('sun'));
    g.addNode(shape3D('box', { extrusionDepth: 40, acceptsLights: true }));
    const body = snap(g).layers.find((l) => l.id === 'box::ext-mesh')!;
    expect(body.lighting).toEqual([1, 1, 1]);
    expect(body.shade3d?.oneSided).toBe(true);
  });

  it('the mesh key changes with depth and bevel (GPU buffers re-upload only then)', () => {
    const g = new SceneGraph();
    g.addNode(shape3D('box', { extrusionDepth: 40 }));
    const k1 = snap(g).layers[0]!.extrudedMesh!.key;
    const k1b = snap(g).layers[0]!.extrudedMesh!.key;
    expect(k1b).toBe(k1);
    const g2 = new SceneGraph();
    g2.addNode(shape3D('box', { extrusionDepth: 41 }));
    expect(snap(g2).layers[0]!.extrudedMesh!.key).not.toBe(k1);
  });

  it('keyframed extrusionDepth is sampled at the frame time', () => {
    const g = new SceneGraph();
    g.addNode(shape3D('box', { extrusionDepth: 0 }));
    const anim = new AnimationEngine();
    anim.setKeyframe('box', 'extrusionDepth', 0, 0);
    anim.setKeyframe('box', 'extrusionDepth', 1, 100);
    expect(snap(g, anim, 0).layers.map((l) => l.id)).toEqual(['box']);
    const at = snap(g, anim, 0.5).layers;
    expect(at.map((l) => l.id)).toEqual(['box::ext-mesh', 'box']);
    let maxZ = -Infinity;
    const v = at[0]!.extrudedMesh!.vertices;
    for (let i = 2; i < v.length; i += MESH_VERTEX_FLOATS) maxZ = Math.max(maxZ, v[i]!);
    expect(maxZ).toBeCloseTo(50, 5);
  });
});

describe('mesh extrusion through the FrameScene adapter', () => {
  it('the carrier becomes a depth-eligible renderable whose model is the bare world3d', () => {
    const g = new SceneGraph();
    g.addNode(shape3D('box', { extrusionDepth: 40, rotationY: 30 }));
    const snapshot = snap(g);
    const scene = snapshotToFrameScene(snapshot);
    const body = scene.renderables.find((r) => r.id === 'box::ext-mesh')!;
    expect(body).toBeDefined();
    expect(body.extrudedMesh).toBeDefined();
    expect(body.threeD?.model).toEqual(snapshot.layers[0]!.world3d);
    expect(depthEligible3D(body)).toBe(true);
    // Colours resolved, gains carried.
    const side = body.extrudedMesh!.ranges.find((r) => r.role === 'side')!;
    expect(side.color.b).toBeGreaterThan(side.color.r);
    expect(side.gain).toBe(EXTRUSION_WALL_GAIN);
  });

  it('a GLASS object leaves the depth group as a whole — and takes its mesh with it', () => {
    const g = new SceneGraph();
    g.addNode(shape3D('box', { extrusionDepth: 40, glass: { enabled: true, blur: 10 } }));
    const scene = snapshotToFrameScene(snap(g));
    const front = scene.renderables.find((r) => r.id === 'box');
    const body = scene.renderables.find((r) => r.id === 'box::ext-mesh');
    expect(front).toBeDefined();
    // The painter path cannot draw a mesh: rather than paint its carrier as a
    // flat quad in the wall colour over the object, it is dropped.
    if (front && !depthEligible3D(front)) expect(body).toBeUndefined();
    else expect(body).toBeDefined();
  });

  it('the scene carries a 3D camera when a mesh is present', () => {
    const g = new SceneGraph();
    g.addNode(shape3D('box', { extrusionDepth: 40 }));
    const scene = snapshotToFrameScene(snap(g));
    expect(scene.camera3d).toBeDefined();
  });
});
