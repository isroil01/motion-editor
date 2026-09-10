/**
 * Colour LUTs — Levels, Curves, Posterize, Exposure, Lumetri, everything the
 * app's `isLutEffect` admits, arriving as a `lut:<id>` strip — on the lit-3d
 * TEXTURED path: a 3D quad in a depth group, an extrusion's cap or gradient
 * plate, an imported model's base colour.
 *
 * Until the `-lut` variants existed a LUT reached no mesh at all, and a textured
 * 3D quad in a depth group skipped it ("no LUT variant in the 3D material set").
 * FLAT surfaces are graded on the CPU by the adapter; these pin the GPU half, in
 * the three places it can rot without a single golden noticing:
 *
 *   1. The goldens gate. A draw WITHOUT a LUT must compile the exact shader and
 *      bind the exact group it did before. So the variants are separate
 *      pipelines, derived from the bases by substitution, and the bases are
 *      untouched — checked here by cutting the stage back out of each variant
 *      and comparing what is left to its base, character for character.
 *   2. The binding contract, which is TEXT: WGSL binds by number, WebGL2 by the
 *      material's positional sampler names. Neither is visible to `tsc`.
 *   3. The routing: which pipeline a draw actually gets, with and without a
 *      strip, observed through the backend a real frame is submitted to.
 */

import { BUILTIN_SHADERS } from '../shaders/builtin';
import {
  TEXTURED3D_MATERIAL,
  MESH3D_TEXTURED_MATERIAL,
  MESH3D_PBR_MATERIAL,
  MASKED_TEXTURED3D_MATERIAL,
  TEXTURED3D_LUT_MATERIAL,
  TEXTURED3D_LUT_LINEAR_MATERIAL,
  MESH3D_TEXTURED_LUT_MATERIAL,
  MESH3D_TEXTURED_LUT_LINEAR_MATERIAL,
  MESH3D_PBR_LUT_MATERIAL,
  type MaterialDescriptor,
} from '../shaders/Material';
import {
  LUT3D_TEXTURE_BINDING,
  SHADOW2_TEXTURE_BINDING,
  type BindGroupDescriptor,
  type BindGroupHandle,
  type PipelineDescriptor,
  type PipelineHandle,
} from '../gpu/types';
import { NullBackend } from '../gpu/backends/NullBackend';
import { Renderer } from '../core/renderer/Renderer';
import { Mat3 } from '../core/math/Mat3';
import { Color } from '../core/math/Color';
import type { FrameScene, Renderable } from '../scene/FrameScene';

const byName = new Map(BUILTIN_SHADERS.map((s) => [s.name, s]));

const VARIANTS: ReadonlyArray<{ name: string; base: string; material: MaterialDescriptor; baseMaterial: MaterialDescriptor }> = [
  { name: 'textured3d-lut', base: 'textured3d', material: TEXTURED3D_LUT_MATERIAL, baseMaterial: TEXTURED3D_MATERIAL },
  { name: 'textured3d-lut-linear', base: 'textured3d-linear', material: TEXTURED3D_LUT_LINEAR_MATERIAL, baseMaterial: TEXTURED3D_MATERIAL },
  { name: 'mesh3d-textured-lut', base: 'mesh3d-textured', material: MESH3D_TEXTURED_LUT_MATERIAL, baseMaterial: MESH3D_TEXTURED_MATERIAL },
  { name: 'mesh3d-textured-lut-linear', base: 'mesh3d-textured-linear', material: MESH3D_TEXTURED_LUT_LINEAR_MATERIAL, baseMaterial: MESH3D_TEXTURED_MATERIAL },
  { name: 'mesh3d-pbr-lut', base: 'mesh3d-pbr', material: MESH3D_PBR_LUT_MATERIAL, baseMaterial: MESH3D_PBR_MATERIAL },
];

/** Every identifier the stage introduces. A line carrying one is a stage line. */
const STAGE_TOKEN = /\b(?:lutTex|uLutTex|lutIn|lutR|lutG|lutB)\b/;

/** A variant with its LUT stage cut back out — which must be its base, exactly. */
function withoutStage(src: string, lang: 'wgsl' | 'glsl'): string {
  const kept = src.split('\n').filter((l) => !STAGE_TOKEN.test(l)).join('\n');
  return lang === 'wgsl'
    ? kept.replace('let affine = ', 'let graded = ')
    : kept.replace('vec3 affine = ', 'vec3 graded = ');
}

describe('the lit-3d LUT variants are their bases plus ONE stage', () => {
  it.each(VARIANTS)('$name is registered beside $base', ({ name, base }) => {
    expect(byName.get(name)).toBeDefined();
    expect(byName.get(base)).toBeDefined();
  });

  it.each(VARIANTS)('★ $name minus the stage IS $base, in both dialects (the goldens gate)', ({ name, base }) => {
    const v = byName.get(name)!;
    const b = byName.get(base)!;
    expect(withoutStage(v.wgsl, 'wgsl')).toBe(b.wgsl);
    expect(withoutStage(v.glsl.fragment, 'glsl')).toBe(b.glsl.fragment);
    // The stage is fragment-only; the vertex stage is shared outright.
    expect(v.glsl.vertex).toBe(b.glsl.vertex);
  });

  it.each(VARIANTS)('$name runs encode → per-channel lookup → decode, term for term in both dialects', ({ name }) => {
    const v = byName.get(name)!;
    // Encoded exactly as the 2D `lut-textured` encodes: the tables are
    // display-referred sRGB.
    expect(v.wgsl).toContain('let lutIn = linearToSrgbRgb(clamp(affine, vec3<f32>(0.0), vec3<f32>(1.0)));');
    expect(v.glsl.fragment).toContain('vec3 lutIn = linearToSrgbRgb(clamp(affine, 0.0, 1.0));');
    for (const [c, i] of [['R', 'r'], ['G', 'g'], ['B', 'b']] as const) {
      expect(v.wgsl).toContain(`let lut${c} = textureSample(lutTex, smp, vec2<f32>(lutIn.${i}, 0.5)).${i};`);
      expect(v.glsl.fragment).toContain(`float lut${c} = texture(uLutTex, vec2(lutIn.${i}, 0.5)).${i};`);
    }
    // ALWAYS decoded back: the light stage works in working space.
    expect(v.wgsl).toContain('let graded = srgbToLinearRgb(vec3<f32>(lutR, lutG, lutB));');
    expect(v.glsl.fragment).toContain('vec3 graded = srgbToLinearRgb(vec3(lutR, lutG, lutB));');
  });

  it('encodes the same way the 2D lut-textured shader does, so a flat layer and a 3D one read one table alike', () => {
    const flat = byName.get('lut-textured')!;
    expect(flat.wgsl).toContain('linearToSrgbRgb(clamp(');
    expect(flat.wgsl).toContain('vec2<f32>(graded.r, 0.5)');
  });

  it.each(VARIANTS)('$name grades the SURFACE colour — the lookup lands before the light stage', ({ name }) => {
    const v = byName.get(name)!;
    const fs = v.wgsl.slice(v.wgsl.indexOf('@fragment'));
    expect(fs.indexOf('let graded = srgbToLinearRgb(')).toBeGreaterThan(-1);
    expect(fs.indexOf('let graded = srgbToLinearRgb(')).toBeLessThan(fs.indexOf('shade3d'));
    const main = v.glsl.fragment.slice(v.glsl.fragment.indexOf('void main()'));
    expect(main.indexOf('vec3 graded = srgbToLinearRgb(')).toBeLessThan(main.indexOf('shade3d'));
  });

  it.each(VARIANTS)('$name samples the strip at top level, never inside a branch (WGSL uniformity)', ({ name }) => {
    const v = byName.get(name)!;
    for (const src of [v.wgsl, v.glsl.fragment]) {
      const taps = src.split('\n').filter((l) => /textureSample\(lutTex|texture\(uLutTex/.test(l));
      expect(taps).toHaveLength(3);
      for (const line of taps) {
        expect(line).not.toMatch(/^\s*(if|for|while)\b/);
        expect(line).not.toContain('? texture');
      }
    }
  });
});

describe('the binding contract', () => {
  it.each(VARIANTS)('$name declares the strip at LUT3D_TEXTURE_BINDING in WGSL and as the LAST GLSL sampler', ({ name }) => {
    const v = byName.get(name)!;
    expect(v.wgsl).toContain(`@group(0) @binding(${LUT3D_TEXTURE_BINDING}) var lutTex : texture_2d<f32>;`);
    const f = v.glsl.fragment;
    const at = f.indexOf('uniform sampler2D uLutTex;');
    expect(at).toBeGreaterThan(-1);
    // Declared after every other sampler, as `glslSamplers` lists it.
    expect(f.slice(at + 1)).not.toMatch(/uniform sampler2D /);
    expect(v.glsl.vertex).not.toContain('uLutTex');
  });

  it.each(VARIANTS)('$name material is its base plus the strip, appended last', ({ name, material, baseMaterial }) => {
    expect(material.shader).toBe(name);
    expect(material.layout).toEqual([
      ...baseMaterial.layout,
      { binding: LUT3D_TEXTURE_BINDING, type: 'texture', stages: ['fragment'] },
    ]);
    // WebGL2 hands out texture units in entry order and QuadRenderer pushes the
    // strip after binding 13, so its name is the last one.
    expect(material.glslSamplers).toEqual([...baseMaterial.glslSamplers!, 'uLutTex']);
    const textures = material.layout.filter((e) => e.type === 'texture').map((e) => e.binding);
    expect(material.glslSamplers!.length).toBe(textures.length);
    expect([...textures].sort((a, b) => a - b)).toEqual(textures);
    expect(material.depth).toEqual(baseMaterial.depth);
    expect(material.buffers).toEqual(baseMaterial.buffers);
  });

  it('sits past every existing slot — the PBR maps (3-6) and the scene set (7-14)', () => {
    expect(LUT3D_TEXTURE_BINDING).toBeGreaterThan(SHADOW2_TEXTURE_BINDING);
    for (const m of [MESH3D_PBR_MATERIAL, TEXTURED3D_MATERIAL, MESH3D_TEXTURED_MATERIAL, MASKED_TEXTURED3D_MATERIAL]) {
      expect(m.layout.map((e) => e.binding)).not.toContain(LUT3D_TEXTURE_BINDING);
    }
  });

  it('★ no base shader samples a strip — the variants are the ONLY carriers', () => {
    for (const name of ['textured3d', 'textured3d-linear', 'mesh3d-textured', 'mesh3d-textured-linear', 'mesh3d-pbr', 'masked-textured3d', 'mesh3d-solid', 'solid3d']) {
      const s = byName.get(name)!;
      expect(s.wgsl).not.toContain('lutTex');
      expect(s.glsl.fragment).not.toContain('uLutTex');
    }
  });
});

// ── Routing, observed through a real frame ─────────────────────────────────

/** NullBackend that also remembers each pipeline's label and each bind group's bindings. */
class SpyBackend extends NullBackend {
  readonly labels = new Map<number, string>();
  readonly groups: Array<{ label: string; bindings: number[] }> = [];
  override createPipeline(desc: PipelineDescriptor): PipelineHandle {
    const h = super.createPipeline(desc);
    this.labels.set(h.id, desc.label ?? '');
    return h;
  }
  override createBindGroup(desc: BindGroupDescriptor): BindGroupHandle {
    this.groups.push({ label: this.labels.get(desc.pipeline.id) ?? '', bindings: desc.entries.map((e) => e.binding) });
    return super.createBindGroup(desc);
  }
  /** Pipeline labels of the draws inside the depth-tested 3D pass. */
  depthLabels(): string[] {
    return this.draws.filter((d) => d.pass === 'composition-3d').map((d) => this.labels.get(d.pipeline) ?? '');
  }
}

const F = 800;
function camera3d() {
  const n = 1;
  const fr = 100000;
  return {
    view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -400, -300, F, 1] as readonly number[],
    projection: [F, 0, 0, 0, 0, F, 0, 0, 400, 300, fr / (fr - n), 1, 0, 0, (-fr * n) / (fr - n), 0] as readonly number[],
  };
}

/** A 100×100 textured 3D quad at (x, y). The default provider resolves every key to white. */
function texturedQuad(id: string, extra: Partial<Renderable> = {}): Renderable {
  return {
    id,
    kind: 'image',
    modelMatrix: Mat3.multiply(Mat3.compose(200, 200, 0, 100, 100), Mat3.translation(-0.5, -0.5)),
    bounds: { x: 150, y: 150, width: 100, height: 100 },
    opacity: 1,
    blend: 'normal',
    color: Color.white(),
    textureKey: `asset:${id}`,
    threeD: { model: [100, 0, 0, 0, 0, 100, 0, 0, 0, 0, 1, 0, 150, 150, 0, 1] },
    ...extra,
  };
}

/** A two-range mesh: a textured front triangle and a flat side triangle. */
function meshCarrier(id: string, extra: Partial<Renderable> = {}): Renderable {
  const v = new Float32Array([
    -50, -50, 0, 0, 0, -1, 0, 0,
    50, -50, 0, 0, 0, -1, 1, 0,
    50, 50, 0, 0, 0, -1, 1, 1,
    -50, 50, 0, 0, 0, -1, 0, 1,
  ]);
  return texturedQuad(id, {
    threeD: { model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 400, 300, 0, 1] },
    extrudedMesh: {
      key: `mesh:${id}`,
      vertices: v,
      indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
      ranges: [
        { role: 'front', first: 0, count: 3, color: Color.white(), gain: 1, textured: true },
        { role: 'side', first: 3, count: 3, color: Color.of(0.2, 0.4, 0.8, 1), gain: 0.8 },
      ],
    },
    ...extra,
  });
}

async function render(renderables: Renderable[]): Promise<SpyBackend> {
  const backend = new SpyBackend();
  const renderer = new Renderer({ backend, now: () => 16 });
  await renderer.initialize();
  const vp = renderer.createViewport({ width: 800, height: 600, overlays: { grid: false, checkerboard: false } });
  vp.camera.setState({ center: { x: 400, y: 300 }, zoom: 1 });
  const scene: FrameScene = {
    composition: { id: 'comp', size: { width: 800, height: 600 }, background: Color.of(0, 0, 0, 1) },
    renderables,
    hasEffects: true,
    camera3d: camera3d(),
  };
  renderer.render(vp, scene);
  return backend;
}

const bindsStrip = (b: SpyBackend, shader: string): boolean[] =>
  b.groups.filter((g) => g.label.startsWith(`${shader}/`)).map((g) => g.bindings.includes(LUT3D_TEXTURE_BINDING));

describe('routing: a strip selects the variant, its absence changes nothing', () => {
  it('a textured 3D quad WITH a strip draws through textured3d-lut and binds it at 15', async () => {
    const b = await render([texturedQuad('q', { lutTextureKey: 'lut:q' })]);
    expect(b.depthLabels()).toEqual(['textured3d-lut/normal']);
    expect(bindsStrip(b, 'textured3d-lut')).toEqual([true]);
  });

  it('★ the same quad WITHOUT one keeps textured3d and binds nothing at 15', async () => {
    const b = await render([texturedQuad('q')]);
    expect(b.depthLabels()).toEqual(['textured3d/normal']);
    expect(b.groups.some((g) => g.bindings.includes(LUT3D_TEXTURE_BINDING))).toBe(false);
  });

  it('a mesh carrier with a strip: the TEXTURED range takes the variant, the flat range does not', async () => {
    // The flat range's colour was graded through the same table on the CPU;
    // remapping it again here would apply the LUT twice.
    const b = await render([meshCarrier('m', { lutTextureKey: 'lut:m' })]);
    expect(b.depthLabels()).toEqual(['mesh3d-textured-lut/normal', 'mesh3d-solid/normal']);
    expect(bindsStrip(b, 'mesh3d-textured-lut')).toEqual([true]);
    expect(bindsStrip(b, 'mesh3d-solid')).toEqual([false]);
  });

  it('★ a mesh carrier without one draws exactly as before', async () => {
    const b = await render([meshCarrier('m')]);
    expect(b.depthLabels()).toEqual(['mesh3d-textured/normal', 'mesh3d-solid/normal']);
    expect(b.groups.some((g) => g.bindings.includes(LUT3D_TEXTURE_BINDING))).toBe(false);
  });

  it('a glTF material with maps AND a strip draws through mesh3d-pbr-lut', async () => {
    const b = await render([meshCarrier('p', {
      lutTextureKey: 'lut:p',
      extrudedMesh: {
        ...meshCarrier('p').extrudedMesh!,
        pbr: { normalKey: 'pbrmap:p:n', normalScale: 1, occlusionStrength: 1, emissive: [0, 0, 0] },
      },
    })]);
    expect(b.depthLabels()[0]).toBe('mesh3d-pbr-lut/normal');
    const pbrGroups = b.groups.filter((g) => g.label === 'mesh3d-pbr-lut/normal');
    expect(pbrGroups.length).toBeGreaterThan(0);
    // The maps keep 3-6; the strip is the one extra entry, last.
    for (const g of pbrGroups) {
      expect(g.bindings.slice(-1)).toEqual([LUT3D_TEXTURE_BINDING]);
      expect(g.bindings).toEqual(expect.arrayContaining([3, 4, 5, 6]));
    }
  });
});
