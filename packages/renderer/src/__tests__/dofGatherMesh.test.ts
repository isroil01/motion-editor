/**
 * Camera DOF reaches 3D MESHES (extrusions, primitives, glTF) through the
 * per-pixel gather — and only through it.
 *
 * render3DGroup draws an `extrudedMesh` straight off its buffers, BEFORE the
 * effects branch, so a mesh has no per-layer DOF blur to fall back on; and
 * buildSnapshot keeps the camera-DOF blur off the mesh gate on the promise
 * that the gather defocuses it. That promise holds exactly as long as
 * DOF_TARGET yields a sampleable depth texture while the scene / precomp
 * targets are 4× MSAA (whose depth never does). These tests pin both halves
 * on the NullBackend, which follows WebGPU's rule: depth is sampleable only on
 * a single-sample target.
 */

import { Renderer } from '../core/renderer/Renderer';
import { NullBackend } from '../gpu/backends/NullBackend';
import type { RenderTargetHandle, TextureHandle } from '../gpu/types';
import { Mat3 } from '../core/math/Mat3';
import { Color } from '../core/math/Color';
import type { FrameScene, Renderable } from '../scene/FrameScene';
import { buildDefaultGraph, DOF_TARGET, MSAA_SAMPLES, PRECOMP_TARGETS, SCENE_COLOR_TARGET } from '../rendergraph/passes';

const F = 800;
type Dof = NonNullable<NonNullable<FrameScene['camera3d']>['dof']>;
const DOF: Dof = { strength: 12, focus: F, aperture: 12 };
const DOF_BLUR = { type: 'blur' as const, radiusPx: 6, dofSource: true };

function camera3d(dof?: Dof): NonNullable<FrameScene['camera3d']> {
  const n = 1;
  const fr = 100000;
  return {
    view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -400, -300, F, 1],
    projection: [F, 0, 0, 0, 0, F, 0, 0, 400, 300, fr / (fr - n), 1, 0, 0, (-fr * n) / (fr - n), 0],
    eye: [400, 300, -F],
    ...(dof ? { dof } : {}),
  };
}

const quadModel = (x: number, y: number) => Mat3.multiply(Mat3.compose(x, y, 0, 100, 100), Mat3.translation(-0.5, -0.5));

/** One solid triangle — the smallest thing that takes the mesh branch. */
function mesh(id: string, effects?: Renderable['effects']): Renderable {
  return {
    id,
    kind: 'rect',
    modelMatrix: quadModel(400, 300),
    bounds: { x: 350, y: 250, width: 100, height: 100 },
    opacity: 1,
    blend: 'normal',
    color: Color.white(),
    threeD: { model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 400, 300, 0, 1] },
    extrudedMesh: {
      key: `test-mesh:${id}`,
      vertices: new Float32Array([
        -50, -50, 0, 0, 0, -1, 0, 0,
        50, -50, 0, 0, 0, -1, 1, 0,
        0, 50, 0, 0, 0, -1, 0.5, 1,
      ]),
      indices: new Uint16Array([0, 1, 2]),
      ranges: [{ role: 'side', first: 0, count: 3, color: Color.white(), gain: 1 }],
    },
    ...(effects ? { effects } : {}),
  };
}

function card(id: string, x: number, y: number, effects?: Renderable['effects']): Renderable {
  return {
    id,
    kind: 'rect',
    modelMatrix: quadModel(x, y),
    bounds: { x: x - 50, y: y - 50, width: 100, height: 100 },
    opacity: 1,
    blend: 'normal',
    color: Color.white(),
    threeD: { model: [100, 0, 0, 0, 0, 100, 0, 0, 0, 0, 1, 0, x - 50, y - 50, 0, 1] },
    ...(effects ? { effects } : {}),
  };
}

function scene(renderables: Renderable[], dof?: Dof): FrameScene {
  return {
    composition: { id: 'comp', size: { width: 800, height: 600 }, background: Color.of(0, 0, 0, 1) },
    renderables,
    hasEffects: true,
    camera3d: camera3d(dof),
  };
}

async function render(s: FrameScene, backend = new NullBackend()): Promise<NullBackend> {
  const renderer = new Renderer({ backend, now: () => 16 });
  await renderer.initialize();
  const vp = renderer.createViewport({ width: 800, height: 600, overlays: { grid: false, checkerboard: false } });
  vp.camera.setState({ center: { x: 400, y: 300 }, zoom: 1 });
  renderer.render(vp, s);
  return backend;
}

/** The draw log without pipeline ids (those come off a global counter). */
const drawShape = (b: NullBackend) => b.draws.map((d) => `${d.pass}:${d.indexed ? 'i' : 'v'}${d.vertexCount}x${d.instanceCount}`);
const meshDraws = (b: NullBackend) => b.draws.filter((d) => d.pass === 'composition-3d' && d.indexed && d.vertexCount === 3);

/** A backend that can never sample depth — the one config the gather cannot serve. */
class NoDepthSamplingBackend extends NullBackend {
  override renderTargetDepthTexture(_target: RenderTargetHandle): TextureHandle | null {
    return null;
  }
}

describe('DOF gather availability under MSAA', () => {
  const graph = buildDefaultGraph();
  const descOf = (name: string) => (graph as unknown as {
    targets: Map<string, { descriptor: (vp: never) => { depth?: boolean; samples?: number; width: number; height: number; format: 'rgba16float' } }>;
  }).targets.get(name)!.descriptor({ pixelSize: { width: 800, height: 600 } } as never);

  it('DOF_TARGET is single-sample and depth-capable while the scene and precomp targets are MSAA', () => {
    const dofDesc = descOf(DOF_TARGET);
    expect(dofDesc.depth).toBe(true);
    expect(dofDesc.samples ?? 1).toBe(1);
    expect(descOf(SCENE_COLOR_TARGET).samples).toBe(MSAA_SAMPLES);
    for (const name of PRECOMP_TARGETS) expect(descOf(name).samples).toBe(MSAA_SAMPLES);
  });

  it('the MSAA scene target has no sampleable depth; DOF_TARGET does', () => {
    const backend = new NullBackend();
    expect(backend.renderTargetDepthTexture(backend.createRenderTarget(descOf(SCENE_COLOR_TARGET)))).toBeNull();
    expect(backend.renderTargetDepthTexture(backend.createRenderTarget(descOf(DOF_TARGET)))).not.toBeNull();
  });
});

describe('camera DOF on 3D meshes', () => {
  it('a mesh group gathers into the MSAA scene target: the mesh draws, then dof-gather — its DOF is not dropped', async () => {
    const b = await render(scene([mesh('m', [DOF_BLUR])], DOF));
    const at3d = b.passLog.indexOf('composition-3d');
    expect(at3d).toBeGreaterThanOrEqual(0);
    expect(b.passLog.indexOf('dof-gather')).toBeGreaterThan(at3d);
    expect(meshDraws(b)).toHaveLength(1);
    expect(b.draws.filter((d) => d.pass === 'dof-gather')).toHaveLength(1);
    // Defocused once, by the gather — the carrier's per-layer blur never runs.
    expect(b.passLog).not.toContain('threed-fx-src');
    expect(b.passLog).not.toContain('blurH');
  });

  it('a mesh sharing a group with a defocused flat card: one gather covers both, no per-layer blur', async () => {
    const b = await render(scene([card('far', 200, 200, [DOF_BLUR]), mesh('m', [DOF_BLUR])], DOF));
    expect(b.passLog.filter((p) => p === 'dof-gather')).toHaveLength(1);
    expect(meshDraws(b)).toHaveLength(1);
    expect(b.passLog).not.toContain('threed-fx-src');
    expect(b.passLog).not.toContain('blurH');
  });

  it('without DOF nothing changes: no gather, and the DOF-on log is the same passes plus the gather', async () => {
    const off = await render(scene([mesh('m')]));
    const zero = await render(scene([mesh('m')], { ...DOF, strength: 0 }));
    const on = await render(scene([mesh('m', [DOF_BLUR])], DOF));
    expect(off.passLog).not.toContain('dof-gather');
    // A zero-strength lens is no lens: byte-for-byte the no-DOF frame.
    expect(zero.passLog).toEqual(off.passLog);
    expect(drawShape(zero)).toEqual(drawShape(off));
    // DOF adds the gather and nothing else — no MSAA change, no extra pass.
    expect(on.passLog.filter((p) => p !== 'dof-gather')).toEqual(off.passLog);
  });

  it('a backend with no sampleable depth cannot gather: flat cards keep their per-layer CoC blur, the mesh still draws', async () => {
    const b = await render(scene([card('far', 200, 200, [DOF_BLUR]), mesh('m', [DOF_BLUR])], DOF), new NoDepthSamplingBackend());
    expect(b.passLog).not.toContain('dof-gather');
    expect(b.passLog).toEqual(expect.arrayContaining(['threed-fx-src', 'blurH', 'blurV']));
    // Documented residual (see the mesh branch in render3DGroup): drawn, sharp.
    expect(meshDraws(b)).toHaveLength(1);
  });
});
