/**
 * A SEALED composition instance renders its 3D through its OWN camera on the GPU.
 *
 * Before: the nested pass resolved the inner camera but only its CPU projection
 * survived — the instance's children flattened under the instance placement, the
 * identity 3D gate refused them, and they composited flat (no depth test, no
 * per-fragment lighting, no shadow maps). Worse, an instance whose frame equals
 * the host's has an IDENTITY placement, so its children passed that gate and
 * were drawn through the HOST camera.
 *
 * Now the container carries the nested comp's own 3D frame, its children keep
 * `threeD` in inner world space, and the precomp renderable carries the inner
 * camera with the instance placement lifted onto the projection — so the GPU
 * draw lands exactly where the CPU fallback does, through the inner camera.
 */

import { buildSnapshot } from './buildSnapshot';
import { snapshotToFrameScene } from './snapshotToFrameScene';
import SceneGraph from '@core/scene/SceneGraph';
import { AnimationEngine } from '@motion/animation';
import type { SceneNode } from '@core/types';
import type { Renderable } from '@motion/renderer';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { COMP_REF_PROP } from '@core/scene/compInstance';

const HOST = { width: 800, height: 600 };

function node(id: string, kind: string, parent: string | null, props: Record<string, unknown>, fx?: Record<string, unknown>): SceneNode {
  const components: unknown[] = [
    { id: `${id}_t`, type: 'Transform', props: { [SCENE_KIND_PROP]: kind, x: 0, y: 0, rotation: 0, ...props } },
    { id: `${id}_s`, type: 'Style', props: { opacity: 100, fill: '#2b7eff' } },
  ];
  if (fx) components.push({ id: `${id}_fx`, type: 'fx', props: fx });
  return {
    id, name: id, parent, children: [], visible: true, locked: false,
    transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } },
    components,
  } as unknown as SceneNode;
}

interface Opts {
  inner: { width: number; height: number };
  inst: { x: number; y: number };
  /** Give the inner comp 3D content (a camera, a light and a lit 3D box). */
  inner3d: boolean;
}

/** Host with a camera pushed far off to one side (x = 1400), holding a placed
 *  composition. "Did the host camera reach the inner layer?" is then visible. */
function build({ inner, inst, inner3d }: Opts) {
  const g = new SceneGraph();
  g.addNode(node('host', 'group', null, {}));
  g.addNode(node('inner', 'group', null, {}));
  if (inner3d) {
    g.addChild('inner', node('icam', 'camera', 'inner', {
      x: inner.width / 2 - 40, y: inner.height / 2 + 20, z: -700, focalLength: 700,
    }));
    g.addChild('inner', node('ilight', 'light', 'inner', {
      x: inner.width / 2, y: 20, z: -400, intensity: 100, radius: 2000,
    }));
    g.addChild('inner', node('ibox', 'shape', 'inner', {
      x: inner.width / 2 + 30, y: inner.height / 2 - 10, z: 150, rotationX: 0, rotationY: 0, width: 60, height: 40,
      acceptsLights: true,
    }));
  }
  g.addChild('inner', node('iflat', 'shape', 'inner', {
    x: inner.width / 2, y: inner.height / 2, width: 50, height: 50,
  }));
  g.addChild('host', node('cam', 'camera', 'host', { x: 1400, y: HOST.height / 2, z: -1000, focalLength: 1000 }));
  g.addChild('host', node('inst', 'comp', 'host', { x: inst.x, y: inst.y }, {
    precomp: true,
    [COMP_REF_PROP]: 'inner',
  }));
  const snapshot = buildSnapshot(g, new AnimationEngine(), 0, undefined, undefined, undefined, undefined, {
    ...HOST,
    background: '#000',
    rootId: 'host',
    compSizeOf: (id: string) => (id === 'inner' ? inner : undefined),
  } as never);
  return { snapshot, scene: snapshotToFrameScene(snapshot) };
}

/** Column-major mat4 · (x, y, z, 1), then the perspective divide. */
function project(m: ArrayLike<number>, x: number, y: number, z: number): [number, number] {
  const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  return [cx / cw, cy / cw];
}

function mul4(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
      out[c * 4 + r] = s;
    }
  }
  return out;
}

/** Where the GPU path puts unit-quad point (u, v): P · V · model. */
function gpuPoint(cam: { view: readonly number[]; projection: readonly number[] }, model: readonly number[], u: number, v: number) {
  return project(mul4(cam.projection, mul4(cam.view, model)), u, v, 0);
}

/** Where the CPU-projected affine fallback puts it: the 2D model matrix. */
function flatPoint(m: ArrayLike<number>, u: number, v: number): [number, number] {
  return [m[0]! * u + m[3]! * v + m[6]!, m[1]! * u + m[4]! * v + m[7]!];
}

const UNIT_POINTS: ReadonlyArray<[number, number]> = [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]];

describe('a sealed comp instance WITH its own 3D', () => {
  const INNER = { width: 400, height: 300 };
  const { snapshot, scene } = build({ inner: INNER, inst: { x: 500, y: 400 }, inner3d: true });
  const container = snapshot.layers.find((l) => l.id === 'inst')!;
  const pre = scene.renderables.find((r) => r.id === 'inst')!;
  const child = pre.precomp!.renderables.find((r) => r.id.endsWith('ibox'))!;

  it('keeps the nested comp\'s own camera and lights on the container', () => {
    expect(container.precompScene3d).toBeDefined();
    const eye = container.precompScene3d!.camera3d.eye!;
    expect(eye[0]).toBeCloseTo(INNER.width / 2 - 40, 6);
    expect(eye[2]).toBeCloseTo(-700, 6);
    expect(container.precompScene3d!.lights3d!.length).toBeGreaterThan(0);
    // The host frame is the host's.
    expect(snapshot.camera3d!.eye![0]).toBeCloseTo(1400, 6);
  });

  it('isolates, and the precomp renderable carries the INNER camera + lights', () => {
    expect(pre.precomp).toBeDefined();
    expect(pre.precomp!.camera3d).toBeDefined();
    expect(pre.precomp!.camera3d!.eye).toEqual(container.precompScene3d!.camera3d.eye);
    expect(pre.precomp!.camera3d!.view).toEqual(container.precompScene3d!.camera3d.view);
    expect(pre.precomp!.lights3d).toEqual(container.precompScene3d!.lights3d);
  });

  it('the child keeps true 3D (depth test) with per-fragment shading', () => {
    expect(child.threeD).toBeDefined();
    expect(child.threeD!.shade).toBeDefined();
  });

  it('through the inner camera, the GPU draw lands exactly where the flat fallback does', () => {
    for (const [u, v] of UNIT_POINTS) {
      const [gx, gy] = gpuPoint(pre.precomp!.camera3d!, child.threeD!.model, u, v);
      const [fx, fy] = flatPoint(child.modelMatrix, u, v);
      expect(gx).toBeCloseTo(fx, 4);
      expect(gy).toBeCloseTo(fy, 4);
    }
  });

  it('the HOST camera never reaches it', () => {
    const host = scene.camera3d!;
    expect(pre.precomp!.camera3d!.eye).not.toEqual(host.eye);
    // Drawn through the host camera, the same model would land somewhere else
    // entirely — hundreds of px off (the host camera sits at x = 1400).
    const [hx] = gpuPoint(host, child.threeD!.model, 0.5, 0.5);
    const [fx] = flatPoint(child.modelMatrix, 0.5, 0.5);
    expect(Math.abs(hx - fx)).toBeGreaterThan(100);
  });

  it('leaves the placement out of the depth row (depth order / DOF are the inner camera\'s)', () => {
    const inner = container.precompScene3d!.camera3d.projection;
    const placed = pre.precomp!.camera3d!.projection;
    for (const i of [2, 3, 6, 7, 10, 11, 14, 15]) expect(placed[i]).toBeCloseTo(inner[i]!, 9);
  });
});

describe('a sealed comp instance whose frame EQUALS the host\'s', () => {
  // Same size, centred: the instance placement is the identity, which used to
  // pass the old identity gate — the children kept `threeD` and were drawn
  // through the HOST camera.
  const { scene } = build({ inner: HOST, inst: { x: HOST.width / 2, y: HOST.height / 2 }, inner3d: true });
  const pre = scene.renderables.find((r) => r.id === 'inst')!;

  it('no longer leaks the host camera — the precomp brings its own', () => {
    expect(pre.precomp?.camera3d).toBeDefined();
    expect(pre.precomp!.camera3d!.eye![0]).toBeCloseTo(HOST.width / 2 - 40, 6);
    expect(pre.precomp!.camera3d!.eye).not.toEqual(scene.camera3d!.eye);
  });

  it('and the child still lands where the flat fallback does', () => {
    const child = pre.precomp!.renderables.find((r) => r.id.endsWith('ibox'))!;
    expect(child.threeD).toBeDefined();
    for (const [u, v] of UNIT_POINTS) {
      const [gx, gy] = gpuPoint(pre.precomp!.camera3d!, child.threeD!.model, u, v);
      const [fx, fy] = flatPoint(child.modelMatrix, u, v);
      expect(gx).toBeCloseTo(fx, 4);
      expect(gy).toBeCloseTo(fy, 4);
    }
  });
});

describe('a sealed comp instance WITHOUT 3D', () => {
  const { snapshot, scene } = build({ inner: { width: 400, height: 300 }, inst: { x: 500, y: 400 }, inner3d: false });

  it('is unchanged: no nested 3D frame on the container or the renderable', () => {
    const container = snapshot.layers.find((l) => l.id === 'inst')!;
    expect('precompScene3d' in container).toBe(false);
    const pre = scene.renderables.find((r) => r.id === 'inst')! as Renderable;
    expect(Object.keys(pre.precomp!)).toEqual(['renderables']);
    expect(pre.precomp!.renderables.every((r) => r.threeD === undefined)).toBe(true);
  });
});
