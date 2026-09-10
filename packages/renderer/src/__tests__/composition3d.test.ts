/**
 * 3D render groups (CompositionPass): contiguous depth-eligible 3D renderables
 * render as ONE depth-tested pass ('composition-3d') into the scene colour
 * target; 2D layers and offscreen-routed layers (effects/mattes) break the
 * group and keep the painter's-order path. Verified against the NullBackend's
 * pass/draw log.
 */

import { Renderer } from '../core/renderer/Renderer';
import { NullBackend } from '../gpu/backends/NullBackend';
import { Mat3 } from '../core/math/Mat3';
import { Color } from '../core/math/Color';
import type { FrameScene, Renderable } from '../scene/FrameScene';

const F = 800;

function camera3d() {
  const n = 1;
  const fr = 100000;
  return {
    view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -400, -300, F, 1] as readonly number[],
    projection: [F, 0, 0, 0, 0, F, 0, 0, 400, 300, fr / (fr - n), 1, 0, 0, (-fr * n) / (fr - n), 0] as readonly number[],
  };
}

function rect(id: string, x: number, y: number, threeD = false, extra: Partial<Renderable> = {}): Renderable {
  const w = 100;
  const h = 100;
  const model = Mat3.multiply(Mat3.compose(x, y, 0, w, h), Mat3.translation(-0.5, -0.5));
  return {
    id,
    kind: 'rect',
    modelMatrix: model,
    bounds: { x: x - w / 2, y: y - h / 2, width: w, height: h },
    opacity: 1,
    blend: 'normal',
    color: Color.white(),
    ...(threeD
      ? { threeD: { model: [w, 0, 0, 0, 0, h, 0, 0, 0, 0, 1, 0, x - w / 2, y - h / 2, 0, 1] } }
      : {}),
    ...extra,
  };
}

function scene(renderables: Renderable[], withCamera = true): FrameScene {
  return {
    composition: { id: 'comp', size: { width: 800, height: 600 }, background: Color.of(0, 0, 0, 1) },
    renderables,
    hasEffects: true, // route through the (depth-capable) scene colour target
    ...(withCamera ? { camera3d: camera3d() } : {}),
  };
}

async function render(s: FrameScene): Promise<NullBackend> {
  const backend = new NullBackend();
  const renderer = new Renderer({ backend, now: () => 16 });
  await renderer.initialize();
  const vp = renderer.createViewport({ width: 800, height: 600, overlays: { grid: false, checkerboard: false } });
  vp.camera.setState({ center: { x: 400, y: 300 }, zoom: 1 });
  renderer.render(vp, s);
  return backend;
}

describe('CompositionPass 3D render groups', () => {
  it('a contiguous 3D run renders as one depth pass', async () => {
    const backend = await render(scene([rect('a', 100, 100, true), rect('b', 130, 120, true), rect('c', 160, 140, true)]));
    expect(backend.depthPassLog).toEqual(['composition-3d']);
    // All three quads drawn inside the depth pass.
    expect(backend.draws.filter((d) => d.pass === 'composition-3d')).toHaveLength(3);
  });

  it('a 2D layer breaks the run into two depth groups (AE group semantics)', async () => {
    const backend = await render(
      scene([rect('a', 100, 100, true), rect('flat', 200, 200, false), rect('b', 300, 300, true)]),
    );
    expect(backend.depthPassLog).toEqual(['composition-3d', 'composition-3d']);
    // The 2D layer draws through the ordinary composition pass between them.
    const order = backend.passLog.filter((p) => p === 'composition' || p === 'composition-3d');
    expect(order).toEqual(['composition-3d', 'composition', 'composition-3d']);
  });

  it('without a scene camera the 3D flag is ignored (affine fallback, no depth pass)', async () => {
    const backend = await render(scene([rect('a', 100, 100, true), rect('b', 130, 120, true)], false));
    expect(backend.depthPassLog).toEqual([]);
    expect(backend.stats().draws).toBeGreaterThanOrEqual(2);
  });

  it('an effect-laden 3D layer JOINS the depth group (pre-resolved, then drawn as a 3D quad)', async () => {
    const backend = await render(
      scene([
        rect('a', 100, 100, true),
        rect('fx', 200, 200, true, { effects: [{ type: 'blur', radiusPx: 4 }] }),
        rect('b', 300, 300, true),
      ]),
    );
    // The whole contiguous run is ONE depth group now — the effect layer no
    // longer breaks it. Its effect chain is pre-resolved (blur sub-passes) into
    // an offscreen texture, which is then drawn as a textured3d quad alongside
    // its plain 3D siblings in a single depth pass (3 draws).
    expect(backend.depthPassLog).toEqual(['composition-3d']);
    expect(backend.draws.filter((d) => d.pass === 'composition-3d')).toHaveLength(3);
    // The effect chain ran (blur H+V) as offscreen sub-passes BEFORE the depth
    // pass, and NO ordinary 2D 'composition' pass appears (the effect layer did
    // not drop to the affine painter path).
    expect(backend.passLog).toEqual(expect.arrayContaining(['threed-fx-src', 'blurH', 'blurV']));
    expect(backend.passLog).not.toContain('composition');
    // blurH must precede the depth pass (resolve happens outside/before it).
    expect(backend.passLog.indexOf('blurH')).toBeLessThan(backend.passLog.indexOf('composition-3d'));
  });

  it('a mixed run [3D-plain, 3D-blur, 2D] keeps the 3D pair in one depth group, 2D on the painter path', async () => {
    const backend = await render(
      scene([
        rect('a', 100, 100, true),
        rect('fx', 130, 120, true, { effects: [{ type: 'blur', radiusPx: 4 }] }),
        rect('flat', 300, 300, false),
      ]),
    );
    // The plain + effect 3D layers form ONE depth group (2 draws); the 2D layer
    // draws through the ordinary composition pass after it.
    expect(backend.depthPassLog).toEqual(['composition-3d']);
    expect(backend.draws.filter((d) => d.pass === 'composition-3d')).toHaveLength(2);
    const order = backend.passLog.filter((p) => p === 'composition' || p === 'composition-3d');
    expect(order).toEqual(['composition-3d', 'composition']);
    expect(backend.passLog).toEqual(expect.arrayContaining(['blurH', 'blurV']));
  });

  /** A frame whose light renders a shadow MAP — the only case the hoist is for. */
  const withMapLight = (s: FrameScene): FrameScene => ({
    ...s,
    lights3d: [{
      type: 'spot', color: { r: 1, g: 1, b: 1 }, gain: 1, x: 400, y: 300, z: -400, radius: 1000,
      aimX: 0, aimY: 0, aimZ: 1, halfConeRad: 0.6, coneFeatherRad: 0.1, falloffMode: 0, falloffDistance: 500,
      shadowMap: true,
    }],
  } as never);

  it('with a shadow-mapped light, a WASH between two 3D layers does NOT split the run (hoisted after it)', async () => {
    // The wash sits at the light layer's stacking position, i.e. wherever the
    // user's light happens to be in the stack. It broke the run exactly like
    // any 2D layer, so the shadow map — built per run — saw a caster with no
    // receiver and darkened nothing (the golden scenes work around this by
    // adding the light FIRST, and call the order load-bearing).
    const backend = await render(withMapLight(
      scene([
        rect('caster', 100, 100, true),
        rect('wash', 200, 200, false, { lightWash: true, blend: 'screen' }),
        rect('receiver', 300, 300, true),
      ]),
    ));
    expect(backend.depthPassLog).toEqual(['composition-3d']);
    expect(backend.draws.filter((d) => d.pass === 'composition-3d')).toHaveLength(2);
    // The wash still draws — through the ordinary composition pass, AFTER the
    // one depth group rather than in the middle of it.
    const order = backend.passLog.filter((p) => p === 'composition' || p === 'composition-3d');
    expect(order).toEqual(['composition-3d', 'composition']);
  });

  it('WITHOUT a shadow-mapped light the wash keeps its painter position (splits the run as before)', async () => {
    // Projected shadows are real geometry in paint order and do not care about
    // runs, so there is nothing to gain — and hoisting would screen the glow
    // over a 3D layer it used to sit beneath (`shadow-catcher`'s caster).
    const backend = await render(
      scene([
        rect('caster', 100, 100, true),
        rect('wash', 200, 200, false, { lightWash: true, blend: 'screen' }),
        rect('receiver', 300, 300, true),
      ]),
    );
    expect(backend.depthPassLog).toEqual(['composition-3d', 'composition-3d']);
    const order = backend.passLog.filter((p) => p === 'composition' || p === 'composition-3d');
    expect(order).toEqual(['composition-3d', 'composition', 'composition-3d']);
  });

  it('a light WASH before the first 3D layer keeps its position (nothing to hoist over)', async () => {
    // The golden light scenes add the light first, so its wash precedes the
    // run — that arrangement must render exactly as it always has.
    const backend = await render(withMapLight(
      scene([
        rect('wash', 200, 200, false, { lightWash: true, blend: 'screen' }),
        rect('a', 100, 100, true),
        rect('b', 300, 300, true),
      ]),
    ));
    expect(backend.depthPassLog).toEqual(['composition-3d']);
    const order = backend.passLog.filter((p) => p === 'composition' || p === 'composition-3d');
    expect(order).toEqual(['composition', 'composition-3d']);
  });

  it('two effect-laden 3D layers split into two depth sub-passes (shared depth, no 2D break)', async () => {
    const backend = await render(
      scene([
        rect('fxa', 100, 100, true, { effects: [{ type: 'blur', radiusPx: 4 }] }),
        rect('fxb', 140, 130, true, { effects: [{ type: 'blur', radiusPx: 4 }] }),
      ]),
    );
    // Each resolved texture lives in the same scratch target, so the first
    // draw must flush before the second resolve overwrites it — two depth
    // sub-passes, one draw each, both still 3D (no ordinary 2D pass between).
    expect(backend.depthPassLog).toEqual(['composition-3d', 'composition-3d']);
    expect(backend.draws.filter((d) => d.pass === 'composition-3d')).toHaveLength(2);
    expect(backend.passLog).not.toContain('composition');
  });

  it('a motion-blurred 3D layer STAYS excluded (breaks the run, offscreen route)', async () => {
    const m = Mat3.multiply(Mat3.compose(200, 200, 0, 100, 100), Mat3.translation(-0.5, -0.5));
    const backend = await render(
      scene([
        rect('a', 100, 100, true),
        rect('mb', 200, 200, true, {
          motionSamples: [
            { modelMatrix: m, opacity: 1 },
            { modelMatrix: m, opacity: 1 },
          ],
        }),
        rect('b', 300, 300, true),
      ]),
    );
    // Motion blur needs an accumulation target (no single-texture resolve), so
    // it remains on the affine/offscreen fallback and breaks the run into two
    // depth groups; the layer itself is NOT drawn inside any depth pass.
    expect(backend.depthPassLog).toEqual(['composition-3d', 'composition-3d']);
    expect(backend.passLog).toContain('layer');
  });

  it('invisible/offscreen 3D layers are culled from the group', async () => {
    const backend = await render(scene([rect('a', 100, 100, true), rect('far', 99999, 99999, true)]));
    expect(backend.draws.filter((d) => d.pass === 'composition-3d')).toHaveLength(1);
  });
});

/**
 * A SEALED comp instance with its own 3D frame: CompositionPass swaps the
 * precomp's camera / lights in for the scene's while it draws the subtree, and
 * the scope it was drawn in comes back afterwards.
 */
describe('CompositionPass: an isolated precomp with its OWN camera', () => {
  const mapLight = {
    type: 'spot', color: { r: 1, g: 1, b: 1 }, gain: 1, x: 400, y: 300, z: -400, radius: 1000,
    aimX: 0, aimY: 0, aimZ: 1, halfConeRad: 0.6, coneFeatherRad: 0.1, falloffMode: 0, falloffDistance: 500,
    shadowMap: true,
  } as const;

  /** A full-comp isolated container around `children`. */
  const precomp = (id: string, children: Renderable[], own: Partial<NonNullable<Renderable['precomp']>> = {}): Renderable => ({
    id,
    kind: 'image',
    modelMatrix: Mat3.multiply(Mat3.compose(400, 300, 0, 800, 600), Mat3.translation(-0.5, -0.5)),
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    opacity: 1,
    blend: 'normal',
    color: Color.white(),
    textureKey: `precomp:${id}`,
    precomp: { renderables: children, ...own },
  });
  const depth3d = (b: NullBackend) => b.depthPassLog.filter((p) => p === 'composition-3d');

  it('renders a composition-3d depth pass INSIDE the precomp through its own camera (the host has none)', async () => {
    const backend = await render(scene([
      precomp('inst', [rect('a', 100, 100, true), rect('b', 300, 300, true)], { camera3d: camera3d() }),
    ], /* host camera */ false));
    expect(depth3d(backend)).toEqual(['composition-3d']);
    expect(backend.draws.filter((d) => d.pass === 'composition-3d')).toHaveLength(2);
    // Inside the precomp: after its target is cleared.
    expect(backend.passLog.indexOf('precomp-clear')).toBeLessThan(backend.passLog.indexOf('composition-3d'));
  });

  it('without its own camera (and none on the host) the children stay on the affine path', async () => {
    const backend = await render(scene([
      precomp('inst', [rect('a', 100, 100, true), rect('b', 300, 300, true)]),
    ], false));
    expect(depth3d(backend)).toEqual([]);
  });

  it('its camera does not leak OUT: a host 3D layer after it has no camera to depth-group with', async () => {
    const backend = await render(scene([
      precomp('inst', [rect('a', 100, 100, true)], { camera3d: camera3d() }),
      rect('host3d', 500, 400, true),
    ], false));
    expect(depth3d(backend)).toEqual(['composition-3d']); // the inner one only
  });

  it('host lights do not reach IN: a host shadow-mapped light hoists nothing inside a comp with no lights', async () => {
    const backend = await render(withMapLightOn(scene([
      precomp('inst', [
        rect('caster', 100, 100, true),
        rect('wash', 200, 200, false, { lightWash: true, blend: 'screen' }),
        rect('receiver', 300, 300, true),
      ], { camera3d: camera3d() }),
    ])));
    // The inner frame has no mapped light, so the wash keeps its painter
    // position and splits the run — as it would in that comp on its own.
    expect(depth3d(backend)).toEqual(['composition-3d', 'composition-3d']);
    expect(backend.passLog).not.toContain('shadow-map');
  });

  it('its own lights apply inside and do not leak out; nested instances swap in turn', async () => {
    const run = (prefix: string) => [
      rect(`${prefix}a`, 100, 100, true),
      rect(`${prefix}wash`, 200, 200, false, { lightWash: true, blend: 'screen' }),
      rect(`${prefix}b`, 300, 300, true),
    ];
    const backend = await render(scene([
      // Outer sealed comp: own camera, NO lights. Inside it, a nested sealed
      // comp with a shadow-mapped light — its wash hoists (one run) — and after
      // it the outer's own run, where the inner light must be gone again (two).
      precomp('outer', [
        precomp('outer::inner', run('i'), { camera3d: camera3d(), lights3d: [mapLight] as never }),
        ...run('o'),
      ], { camera3d: camera3d() }),
      // The host (camera, no lights): the same split as the outer.
      ...run('h'),
    ], true));
    expect(depth3d(backend)).toEqual(['composition-3d', 'composition-3d', 'composition-3d', 'composition-3d', 'composition-3d']);
  });
});

function withMapLightOn(s: FrameScene): FrameScene {
  return {
    ...s,
    lights3d: [{
      type: 'spot', color: { r: 1, g: 1, b: 1 }, gain: 1, x: 400, y: 300, z: -400, radius: 1000,
      aimX: 0, aimY: 0, aimZ: 1, halfConeRad: 0.6, coneFeatherRad: 0.1, falloffMode: 0, falloffDistance: 500,
      shadowMap: true,
    }],
  } as never;
}
