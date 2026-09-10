/**
 * Imported models in the snapshot: a 3D layer carrying a Model component must
 * emit the `extrudedMesh` carrier INSTEAD of its quad (the renderer draws the
 * mesh through the same depth-grouped path as extrusions), and fall back to
 * the plain quad — a visible placeholder — while the registry has not parsed
 * the model yet (project just opened, hydration in flight).
 */

import { buildSnapshot } from './buildSnapshot';
import { snapshotToFrameScene } from './snapshotToFrameScene';
import SceneGraph from '@core/scene/SceneGraph';
import { AnimationEngine } from '@motion/animation';
import type { SceneNode } from '@core/types';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { registerModel, clearModelRegistry, modelKeyForBytes, MODEL_COMPONENT } from '@core/scene/modelMesh';
import { buildQuadGlb, buildMappedQuadGlb } from '@/__testHelpers__/buildTestGlb';
import { buildChannelLut, sampleChannelLutAsUploaded } from '@core/effects/colorLut';
import type { Effect } from '@core/effects/effects';

const COMP = { width: 800, height: 600, background: '#101014' };

function modelLayer(id: string, modelKey: string): SceneNode {
  return {
    id, name: id, parent: null, children: [], visible: true, locked: false,
    transform: { position: { x: 400, y: 300 }, rotation: 0, scale: { x: 1, y: 1 } },
    components: [
      {
        id: `${id}_t`,
        type: 'Transform',
        props: { [SCENE_KIND_PROP]: 'shape', x: 400, y: 300, z: 0, rotation: 0, scaleX: 1, scaleY: 1, width: 2, height: 2 },
      },
      { id: `${id}_s`, type: 'Style', props: { opacity: 100, fill: '#ff0000ff' } },
      { id: `${id}_model`, type: MODEL_COMPONENT, props: { modelKey, mesh: 0, prim: 0 } },
    ],
  } as unknown as SceneNode;
}

describe('buildSnapshot — imported model meshes', () => {
  afterEach(() => clearModelRegistry());

  it('emits the mesh carrier in place of the quad once the model is registered', () => {
    const glb = buildQuadGlb();
    const key = modelKeyForBytes(new Uint8Array(glb));
    registerModel(key, glb);

    const g = new SceneGraph();
    g.addNode(modelLayer('m1', key));
    const snap = buildSnapshot(g, new AnimationEngine(), 0, undefined, undefined, undefined, undefined, COMP);

    const emitted = snap.layers.filter((l) => l.id.startsWith('m1'));
    expect(emitted).toHaveLength(1);
    const mesh = emitted[0]!.extrudedMesh;
    expect(mesh).toBeDefined();
    expect(mesh!.key).toBe(`${key}:m0p0`);
    expect(mesh!.vertices).toHaveLength(4 * 8);
    expect(mesh!.indices).toHaveLength(6);
    expect(mesh!.ranges).toHaveLength(1);
    // doubleSided material → role 'front' (two-sided lighting downstream);
    // untextured → the material's base colour as the range fill.
    expect(mesh!.ranges[0]).toMatchObject({ role: 'front', first: 0, count: 6, fill: '#ff0000ff', gain: 1 });
    // The carrier scrubs what the mesh path cannot stage.
    expect(emitted[0]!.motionSamples).toBeUndefined();
    expect(emitted[0]!.effects).toBeUndefined();
  });

  it('an UNREGISTERED model renders the plain quad placeholder, not nothing', () => {
    const g = new SceneGraph();
    g.addNode(modelLayer('m1', 'gltf-deadbeef-0'));
    const snap = buildSnapshot(g, new AnimationEngine(), 0, undefined, undefined, undefined, undefined, COMP);
    const emitted = snap.layers.filter((l) => l.id.startsWith('m1'));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.extrudedMesh).toBeUndefined();
  });

  it('a 2D layer with a Model component keeps its quad (the mesh path is 3D-only)', () => {
    const glb = buildQuadGlb();
    const key = modelKeyForBytes(new Uint8Array(glb));
    registerModel(key, glb);
    const node = modelLayer('m1', key);
    // Strip the z prop → not 3D.
    const t = node.components.find((c) => c.type === 'Transform')!;
    delete (t.props as Record<string, unknown>).z;
    const g = new SceneGraph();
    g.addNode(node);
    const snap = buildSnapshot(g, new AnimationEngine(), 0, undefined, undefined, undefined, undefined, COMP);
    expect(snap.layers.find((l) => l.id.startsWith('m1'))!.extrudedMesh).toBeUndefined();
  });
});

/**
 * Effects on a model: the carrier keeps what the mesh draw can honour — the
 * ENABLED colour effects, affine and LUT alike, the extrusion carrier's rule —
 * and drops the rest rather than half-applying them. Checked through the
 * adapter too, so the kept effects are shown to change the range colour the
 * mesh is drawn with, not merely to survive on the snapshot.
 */
describe('buildSnapshot — colour effects on a model mesh', () => {
  afterEach(() => clearModelRegistry());

  function withEffects(effects: unknown[]): SceneNode {
    const node = modelLayer('m1', modelKeyForBytes(new Uint8Array(buildQuadGlb())));
    node.components.push({ id: 'm1_fx', type: 'fx', props: { effects } } as unknown as SceneNode['components'][number]);
    return node;
  }

  it('keeps enabled colour effects — affine AND LUT — and grades the range by both; strips blur and disabled effects', () => {
    const glb = buildQuadGlb();
    registerModel(modelKeyForBytes(new Uint8Array(glb)), glb);
    // Output white 128: halves whatever reaches white, so it cannot hide as a no-op.
    const lv: Effect = { id: 'fx_lv', type: 'levels', params: { inputBlack: 0, inputWhite: 255, gamma: 1, outputBlack: 0, outputWhite: 128 } };
    const g = new SceneGraph();
    g.addNode(withEffects([
      { id: 'fx_inv', type: 'invert', params: { amount: 100 } },
      { id: 'fx_blur', type: 'blur', params: { amount: 8 } },
      // Levels is a LUT grade: a flat range runs it through the uploaded table
      // on the CPU, a textured one through the `-lut` mesh material.
      lv,
      { id: 'fx_off', type: 'sepia', enabled: false, params: { amount: 100 } },
    ]));
    const snap = buildSnapshot(g, new AnimationEngine(), 0, undefined, undefined, undefined, undefined, COMP);

    const layer = snap.layers.find((l) => l.id.startsWith('m1'))!;
    expect(layer.extrudedMesh).toBeDefined();
    expect(layer.effects?.map((e) => e.id)).toEqual(['fx_inv', 'fx_lv']);

    // Red fill, inverted → cyan, THEN the Levels table — the affine grade runs
    // first, as it does on the GPU — on the range the mesh draw actually reads.
    const r = snapshotToFrameScene(snap).renderables.find((x) => x.id === layer.id)!;
    const c = r.extrudedMesh!.ranges[0]!.color;
    const want = sampleChannelLutAsUploaded(buildChannelLut([lv])!, [0, 1, 1]);
    expect(want[1]).toBeCloseTo(128 / 255, 5);
    expect(c.r).toBeCloseTo(want[0], 10);
    expect(c.g).toBeCloseTo(want[1], 10);
    expect(c.b).toBeCloseTo(want[2], 10);
  });

  it('a model with only non-colour effects carries none', () => {
    const glb = buildQuadGlb();
    registerModel(modelKeyForBytes(new Uint8Array(glb)), glb);
    const g = new SceneGraph();
    g.addNode(withEffects([{ id: 'fx_blur', type: 'blur', params: { amount: 8 } }]));
    const snap = buildSnapshot(g, new AnimationEngine(), 0, undefined, undefined, undefined, undefined, COMP);
    const layer = snap.layers.find((l) => l.id.startsWith('m1'))!;
    expect(layer.extrudedMesh).toBeDefined();
    expect(layer.effects).toBeUndefined();
  });
});

/**
 * The extra glTF maps, and the gate that keeps them from touching anything
 * else.
 *
 * `pbr` on the carrier is what selects the wider `mesh3d-pbr` pipeline in the
 * renderer. It must appear for a material that HAS maps and be absent for one
 * that does not — because "absent" is what guarantees every extrusion and
 * every previously-imported model keeps compiling the shader it already
 * compiled, and therefore keeps its exact pixels.
 */
describe('buildSnapshot — glTF PBR maps on the mesh carrier', () => {
  const realCreate = (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  beforeEach(() => {
    // jsdom has no createObjectURL, and the registry mints one per image.
    let n = 0;
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = () => `blob:img-${n++}`;
  });
  afterEach(() => {
    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = realCreate;
    clearModelRegistry();
  });

  it('carries each map’s session URL and the material’s own scalars', () => {
    const glb = buildMappedQuadGlb();
    const key = modelKeyForBytes(new Uint8Array(glb));
    registerModel(key, glb);

    const g = new SceneGraph();
    g.addNode(modelLayer('m1', key));
    const snap = buildSnapshot(g, new AnimationEngine(), 0, undefined, undefined, undefined, undefined, COMP);
    const pbr = snap.layers.find((l) => l.id.startsWith('m1'))!.extrudedMesh!.pbr!;

    // images[0] is base colour; 1 normal, 2 metallic-roughness, 3 occlusion,
    // 4 emissive — minted in image order.
    expect(pbr.normalSrc).toBe('blob:img-1');
    expect(pbr.metallicRoughnessSrc).toBe('blob:img-2');
    expect(pbr.occlusionSrc).toBe('blob:img-3');
    expect(pbr.emissiveSrc).toBe('blob:img-4');
    expect(pbr.normalScale).toBe(0.75);
    expect(pbr.occlusionStrength).toBe(0.6);
    expect(pbr.emissive).toEqual([0.5, 0.25, 0]);
  });

  it('★ leaves `pbr` OFF a model with no maps — the goldens-cannot-move gate', () => {
    const glb = buildQuadGlb();
    const key = modelKeyForBytes(new Uint8Array(glb));
    registerModel(key, glb);

    const g = new SceneGraph();
    g.addNode(modelLayer('m1', key));
    const snap = buildSnapshot(g, new AnimationEngine(), 0, undefined, undefined, undefined, undefined, COMP);
    const mesh = snap.layers.find((l) => l.id.startsWith('m1'))!.extrudedMesh!;
    expect(mesh.pbr).toBeUndefined();
    // …and the carrier is otherwise exactly what it was before maps existed.
    expect(mesh.ranges[0]).toMatchObject({ role: 'front', fill: '#ff0000ff', gain: 1 });
  });
});
