/**
 * The three things a 3D composition CARD could not do when it first shipped:
 * blur, take light, and hold a composition with its own 3D camera.
 *
 *   • MOTION BLUR — a card is drawn through a perspective homography, so its
 *     shutter samples are QUADS, re-projected through the sub-frame camera. The
 *     affine samples every other layer uses would smear a rectangle along the
 *     path of a trapezoid.
 *   • ACCEPTS LIGHTS — the per-quad Lambert gain, from the card's own plane
 *     normal, folded into its tint (a card composites through its own
 *     offscreen, so it never takes the per-fragment depth path).
 *   • AN INNER 3D CAMERA — the referenced comp renders its own 3D frame FLAT
 *     into the card, through its own camera, and the card carries that image
 *     into the host's space. It used to fall back to a 2D affine placement.
 */

import { buildSnapshot } from './buildSnapshot';
import { snapshotToFrameScene } from './snapshotToFrameScene';
import SceneGraph from '@core/scene/SceneGraph';
import { AnimationEngine } from '@motion/animation';
import type { SceneNode } from '@core/types';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { COMP_REF_PROP } from '@core/scene/compInstance';

const IDENTITY = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } };
const HOST = { width: 800, height: 600 };
const INNER = { width: 400, height: 300 };
const BLUR = { enabled: true, shutterAngle: 180, shutterPhase: -90, samples: 8, adaptiveSampleLimit: 16, fps: 30 };

function node(id: string, kind: string, parent: string | null, props: Record<string, unknown>, fx?: Record<string, unknown>): SceneNode {
  const components: unknown[] = [
    { id: `${id}_t`, type: 'Transform', props: { [SCENE_KIND_PROP]: kind, x: 0, y: 0, rotation: 0, ...props } },
    { id: `${id}_s`, type: 'Style', props: { opacity: 100, fill: '#2b7eff' } },
  ];
  if (fx) components.push({ id: `${id}_fx`, type: 'fx', props: fx });
  return {
    id, name: id, parent, children: [], visible: true, locked: false, transform: IDENTITY, components,
  } as unknown as SceneNode;
}

interface Opts {
  /** Transform props on the instance (its 3D switch lives here). */
  inst?: Record<string, unknown>;
  /** fx props on the instance (the layer's motion-blur switch). */
  instFx?: Record<string, unknown>;
  /** A light in the HOST comp, for Accepts Lights. */
  light?: boolean;
  /** The referenced comp holds its own camera, light and 3D layer. */
  inner3d?: boolean;
  /** Animate the host camera instead of the card. */
  cameraMove?: boolean;
  animate?: (anim: AnimationEngine) => void;
  blur?: boolean;
}

function build(o: Opts) {
  const g = new SceneGraph();
  g.addNode(node('host', 'group', null, {}));
  g.addNode(node('inner', 'group', null, {}));
  g.addChild('inner', node('iflat', 'shape', 'inner', { x: INNER.width / 2, y: INNER.height / 2, width: 50, height: 50 }));
  if (o.inner3d) {
    g.addChild('inner', node('icam', 'camera', 'inner', { x: INNER.width / 2, y: INNER.height / 2, z: -700, focalLength: 700 }));
    g.addChild('inner', node('ibox', 'shape', 'inner', {
      x: INNER.width / 2 + 30, y: INNER.height / 2, z: 120, width: 60, height: 40, rotationY: 20,
    }));
  }
  if (o.cameraMove) g.addChild('host', node('cam', 'camera', 'host', { x: HOST.width / 2, y: HOST.height / 2, z: -1000, focalLength: 1000 }));
  if (o.light) g.addChild('host', node('lamp', 'light', 'host', { x: HOST.width / 2, y: 0, z: -600, intensity: 100, radius: 4000 }));
  g.addChild('host', node('inst', 'comp', 'host', { x: 400, y: 300, width: INNER.width, height: INNER.height, ...(o.inst ?? {}) }, {
    precomp: true,
    [COMP_REF_PROP]: 'inner',
    ...(o.instFx ?? {}),
  }));
  const anim = new AnimationEngine();
  o.animate?.(anim);
  const snapshot = buildSnapshot(g, anim, 0.5, undefined, undefined, undefined, o.blur ? BLUR : undefined, {
    ...HOST,
    background: '#000000',
    rootId: 'host',
    compSizeOf: (id: string) => (id === 'inner' ? INNER : undefined),
  } as never);
  return { snapshot, scene: snapshotToFrameScene(snapshot), card: snapshot.layers.find((l) => l.id === 'inst')! };
}

/** [TL, TR, BR, BL] of a quad as points. */
function corners(q: readonly number[]): Array<{ x: number; y: number }> {
  return [0, 2, 4, 6].map((i) => ({ x: q[i]!, y: q[i + 1]! }));
}

describe('a 3D comp card — motion blur', () => {
  const spin = (anim: AnimationEngine): void => {
    anim.setKeyframes('inst', 'rotationY', [
      { t: 0, value: 0, easing: 'linear' }, { t: 1, value: 60, easing: 'linear' },
    ] as never);
  };

  it('samples the shutter as QUADS, one perspective per sample', () => {
    const { card } = build({ inst: { z: 0, rotationY: 0 }, instFx: { motionBlur: true }, blur: true, animate: spin });
    const samples = card.motionSamples ?? [];
    expect(samples.length).toBeGreaterThan(1);
    expect(samples.every((s) => s.quad?.length === 8)).toBe(true);
    // The card turns across the shutter, so no two samples share a quad — and
    // the still card sits between the first and the last.
    const width = (q: readonly number[]): number => corners(q)[1]!.x - corners(q)[0]!.x;
    const first = width(samples[0]!.quad!);
    const last = width(samples[samples.length - 1]!.quad!);
    expect(Math.abs(first - last)).toBeGreaterThan(0.5);
    const still = width(card.quad3d!);
    expect(Math.min(first, last)).toBeLessThanOrEqual(still + 1e-6);
    expect(Math.max(first, last)).toBeGreaterThanOrEqual(still - 1e-6);
  });

  it('blurs when the CAMERA moves and the card does not, like any 3D layer', () => {
    const { card } = build({
      inst: { z: 0, rotationY: 30 },
      instFx: { motionBlur: true },
      blur: true,
      cameraMove: true,
      animate: (anim) => anim.setKeyframes('cam', 'x', [
        { t: 0, value: 100, easing: 'linear' }, { t: 1, value: 700, easing: 'linear' },
      ] as never),
    });
    expect((card.motionSamples ?? []).length).toBeGreaterThan(1);
    expect(card.motionSamples!.every((s) => s.quad?.length === 8)).toBe(true);
  });

  it('keeps both switches: no comp blur or no layer switch, no samples', () => {
    expect(build({ inst: { z: 0 }, blur: true, animate: spin }).card.motionSamples).toBeUndefined();
    expect(build({ inst: { z: 0 }, instFx: { motionBlur: true }, animate: spin }).card.motionSamples).toBeUndefined();
    expect(build({ inst: { z: 0 }, instFx: { motionBlur: true }, blur: true }).card.motionSamples).toBeUndefined();
  });

  it('renders each sample through its own homography, not an affine pose', () => {
    const { scene } = build({ inst: { z: 0, rotationY: 0 }, instFx: { motionBlur: true }, blur: true, animate: spin });
    const pre = scene.renderables.find((r) => r.id === 'inst')!;
    expect(pre.precomp!.flat).toEqual({ width: INNER.width, height: INNER.height });
    const models = (pre.motionSamples ?? []).map((s) => s.modelMatrix);
    expect(models.length).toBeGreaterThan(1);
    // A turned card's model is PROJECTIVE — the third row is what an affine
    // sample would have left at zero.
    expect(models.some((m) => Math.abs(m[2]!) > 1e-9 || Math.abs(m[5]!) > 1e-9)).toBe(true);
    expect(models[0]![0]).not.toBeCloseTo(models[models.length - 1]![0]!, 9);
  });
});

describe('a 3D comp card — Accepts Lights', () => {
  it('takes the lamp as a per-quad gain, folded into the card tint', () => {
    const { card, scene } = build({ inst: { z: 0, acceptsLights: true }, light: true });
    expect(card.quad3d).toBeDefined();
    expect(card.lighting).toBeDefined();
    const [r, g, b] = card.lighting!;
    for (const v of [r, g, b]) expect(Number.isFinite(v)).toBe(true);
    const pre = scene.renderables.find((x) => x.id === 'inst')!;
    expect(pre.color!.r).toBeCloseTo(r!, 9);
    expect(pre.color!.g).toBeCloseTo(g!, 9);
    expect(pre.color!.b).toBeCloseTo(b!, 9);
  });

  it('is unlit without the switch, or without a light — the card stays white', () => {
    expect(build({ inst: { z: 0 }, light: true }).card.lighting).toBeUndefined();
    expect(build({ inst: { z: 0, acceptsLights: true } }).card.lighting).toBeUndefined();
    const { scene } = build({ inst: { z: 0 }, light: true });
    const pre = scene.renderables.find((x) => x.id === 'inst')!;
    expect(pre.color).toEqual({ r: 1, g: 1, b: 1, a: 1 });
  });
});

describe('a 3D comp card holding a comp with its OWN 3D camera', () => {
  const { card, scene } = build({ inst: { z: 0, rotationY: 40 }, inner3d: true });
  const pre = scene.renderables.find((r) => r.id === 'inst')!;

  it('is a real card, and still carries the inner comp 3D frame', () => {
    expect(card.quad3d).toBeDefined();
    expect(card.precompScene3d).toBeDefined();
    expect(pre.precomp!.flat).toEqual({ width: INNER.width, height: INNER.height });
  });

  it('keeps the inner camera unlifted — CompositionPass places it on the card', () => {
    // The adapter lifts the placement onto the projection only for a SCREEN-
    // space placement. A card's placement is the offscreen it draws into, which
    // is not known until the viewport is, so the projection here is the inner
    // comp's own.
    expect(pre.precomp!.camera3d!.projection).toEqual(card.precompScene3d!.camera3d.projection);
  });

  it('keeps the inner layers in the comp own pixels, not the host placement', () => {
    const inner = pre.precomp!.renderables.find((r) => r.id.endsWith('iflat'))!;
    // Centred in a 400×300 comp: card space, where the host placement (x 400,
    // y 300, turned 40° in Y) has not been applied.
    expect(inner.modelMatrix[6]! + inner.modelMatrix[0]! / 2).toBeCloseTo(INNER.width / 2, 3);
    expect(inner.modelMatrix[7]! + inner.modelMatrix[4]! / 2).toBeCloseTo(INNER.height / 2, 3);
  });
});
