/**
 * Extrusion meshes for the render snapshot — the layer's outline swept into a
 * real solid (core/geometry/extrudeMesh.ts), cached so an unchanged object
 * costs nothing per frame.
 *
 * This is the mesh-path counterpart of `extrusion.ts`, which synthesises flat
 * quads. The quad model remains the geometry face picking and the gizmos
 * reason about (its faces are simple to hit-test), and the fallback when an
 * outline cannot be produced; RENDERING goes through here.
 *
 * Outlines by layer kind:
 *   • shape rect (incl. per-corner radii) — exact rounded-rect polygon;
 *   • shape ellipse — a ring whose segment count follows the size;
 *   • shape path — the layer's own closed Bézier runs, flattened;
 *   • text — the glyphs TRACED from a 4× raster (`traceTextSpec`) painted by
 *     the SAME painter as the layer's texture, in the same box, so the
 *     silhouette matches the drawn text to ~0.4 px — case, stroke, scale,
 *     baseline shift, per-run styles and text-on-path included;
 *   • anything else (image, video, precomp…) — the layer rect.
 *
 * Two caches: outlines keyed by what shapes them (text content + style, path
 * points, size + radii) and meshes keyed by outline + depth + bevel. Both
 * are small LRUs — the snapshot is rebuilt every frame and must not re-trace
 * text or re-triangulate a glyph set at 60 fps.
 */

import { extrudeOutline, rectOutline, ellipseOutline, bezierRunsToRings, type ExtrudedMesh, type BevelProfile } from '@core/geometry/extrudeMesh';
import type { Ring } from '@core/geometry/polygonTriangulate';
import { layerSubpaths } from '@core/rendering/raster/subpaths';
import { traceTextSpec } from '@core/scene/shapesFromText';
import type { TextPaintSpec } from '@core/rendering/raster/textPaint';
import type { RenderLayer } from '@core/rendering/RenderBackend';
import type { SceneNode } from '@core/types';

const OUTLINE_CACHE_MAX = 64;
const MESH_CACHE_MAX = 128;

class Lru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly max: number) {}
  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, v: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, v);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
  clear(): void {
    this.map.clear();
  }
}

const outlines = new Lru<{ rings: Ring[] } | null>(OUTLINE_CACHE_MAX);
const meshes = new Lru<ExtrudedMesh | null>(MESH_CACHE_MAX);

/** Test seam — and the webfont hook below. */
export function clearExtrusionMeshCaches(): void {
  outlines.clear();
  meshes.clear();
}

// A text outline traced before its webfont arrived is the FALLBACK face's
// silhouette, and its key (content + style) does not change when the real face
// lands — so the body stayed in the wrong font for the session while the front
// face swapped. measureText.ts drops its measurements on the same events.
if (typeof document !== 'undefined' && typeof document.fonts !== 'undefined') {
  void document.fonts.ready.then(clearExtrusionMeshCaches);
  document.fonts.addEventListener?.('loadingdone', clearExtrusionMeshCaches);
}

let meshPathEnabled = true;

/**
 * Test seam: switch the mesh path off so the snapshot takes the quad-synthesis
 * FALLBACK (`extrusion.ts`). That path is still live — it is what renders when
 * an outline cannot be produced — and its own suites keep guarding it through
 * this switch. Production never calls it.
 */
export function setExtrusionMeshPath(enabled: boolean): void {
  meshPathEnabled = enabled;
}

export function isExtrusionMeshPathEnabled(): boolean {
  return meshPathEnabled;
}

function radiiOf(layer: RenderLayer): readonly [number, number, number, number] | number {
  if (layer.cornerRadii) return layer.cornerRadii;
  return layer.cornerRadius ?? 0;
}

function hashPoints(pts: ReadonlyArray<{ x: number; y: number; inX: number; inY: number; outX: number; outY: number }>): string {
  // Cheap content hash: length + a running FNV over rounded coordinates.
  let h = 2166136261;
  const mix = (v: number): void => {
    const r = Math.round(v * 16);
    h ^= r & 0xffff;
    h = Math.imul(h, 16777619);
    h ^= (r >> 16) & 0xffff;
    h = Math.imul(h, 16777619);
  };
  for (const p of pts) {
    mix(p.x); mix(p.y); mix(p.inX); mix(p.inY); mix(p.outX); mix(p.outY);
  }
  return `${pts.length}:${(h >>> 0).toString(36)}`;
}

/**
 * The paint spec for a text RENDER LAYER — the same field set
 * MotionRendererBackend hands the texture provider for the front face, so the
 * silhouette and the texture are the same drawing. Box = the layer box the
 * snapshot measured (`width`/`height` here), the mesh's uvBox.
 */
function textPaintSpecFromLayer(layer: RenderLayer, width: number, height: number): TextPaintSpec | null {
  const text = layer.text ?? 'Text';
  if (!text.trim()) return null;
  return {
    text,
    fontSize: layer.fontSize ?? 48,
    color: '#ffffff',
    width,
    height,
    fontFamily: layer.fontFamily,
    fontWeight: layer.fontWeight,
    fontWidth: layer.fontWidth,
    fontSlant: layer.fontSlant,
    fontStyle: layer.fontStyle,
    align: layer.align,
    letterSpacing: layer.letterSpacing,
    lineHeight: layer.lineHeight,
    paragraphSpacing: layer.paragraphSpacing,
    strokeOverFill: layer.strokeOverFill,
    textTransform: layer.textTransform,
    fontVariant: layer.fontVariant,
    verticalAlign: layer.verticalAlign,
    verticalScale: layer.verticalScale,
    horizontalScale: layer.horizontalScale,
    baselineShift: layer.baselineShift,
    textStroke: layer.textStroke,
    textStrokeWidth: layer.textStrokeWidth,
    runs: layer.runs,
    glyphs: layer.glyphs,
    textPath: layer.textPath,
  };
}

/** Compact hash of the animator output, quantised to 1/4 px / 1/4 unit - the trace cannot see finer. */
function hashGlyphs(glyphs: NonNullable<RenderLayer['glyphs']>): string {
  let h = 2166136261;
  const mix = (v: number): void => {
    const r = Math.round(v * 4);
    h ^= r & 0xffff;
    h = Math.imul(h, 16777619);
    h ^= (r >> 16) & 0xffff;
    h = Math.imul(h, 16777619);
  };
  for (const g of glyphs) {
    mix(g.dx); mix(g.dy); mix(g.scale * 100); mix(g.scaleY * 100); mix(g.rotation);
    mix(g.opacity * 100); mix(g.fillOpacity * 100); mix(g.tracking); mix(g.lineSpacing);
    mix(g.blur); mix(g.skew); mix(g.strokeWidth ?? 0);
    if (g.displayChar) for (let i = 0; i < g.displayChar.length; i++) mix(g.displayChar.charCodeAt(i));
  }
  return `${glyphs.length}:${(h >>> 0).toString(36)}`;
}

/**
 * Everything that shapes the silhouette, so the cache turns over exactly when
 * the pixels would. The old key (content + eight style fields) missed the
 * variable axes, case, scale, baseline shift, stroke, runs, path AND the box
 * size — toggling uppercase or animating `wdth` reused the stale body.
 */
function textSpecKey(s: TextPaintSpec): string {
  const runsKey = s.runs && s.runs.length > 0 ? JSON.stringify(s.runs) : '';
  const pathKey = s.textPath
    ? `${hashPoints(s.textPath.points.map((p) => ({ x: p.x, y: p.y, inX: p.x, inY: p.y, outX: p.x, outY: p.y })))}|${s.textPath.closed ? 1 : 0}|${s.textPath.firstMargin}|${s.textPath.reversed ? 1 : 0}|${s.textPath.perpendicular ? 1 : 0}`
    : '';
  return JSON.stringify([
    s.text, s.fontSize, s.width, s.height,
    s.fontFamily, s.fontWeight, s.fontWidth, s.fontSlant, s.fontStyle,
    s.align, s.letterSpacing, s.lineHeight, s.paragraphSpacing,
    s.textTransform, s.fontVariant, s.verticalAlign, s.verticalScale, s.horizontalScale, s.baselineShift,
    s.textStrokeWidth ?? 0,
    runsKey, pathKey,
  ]);
}

/**
 * The outline key and rings for a layer. `null` when the kind cannot be
 * outlined right now (e.g. text without a canvas) — the caller falls back to
 * the quad synthesis.
 */
export function extrusionOutlineFor(
  layer: RenderLayer,
  _node: SceneNode | undefined,
  width: number,
  height: number,
): { key: string; rings: Ring[] } | null {
  if (!meshPathEnabled) return null;
  const W = Math.max(1, Math.round(width * 100) / 100);
  const H = Math.max(1, Math.round(height * 100) / 100);

  if (layer.kind === 'shape' && layer.primitive === 'ellipse') {
    const key = `ellipse:${W}x${H}`;
    let hit = outlines.get(key);
    if (hit === undefined) {
      hit = { rings: ellipseOutline(W, H) };
      outlines.set(key, hit);
    }
    return hit ? { key, rings: hit.rings } : null;
  }

  if (layer.kind === 'shape' && layer.primitive === 'path') {
    const subs = layerSubpaths(layer).filter((s) => !s.open && s.points.length >= 3);
    if (subs.length === 0) return null;
    const key = `path:${subs.map((s) => hashPoints(s.points)).join('/')}`;
    let hit = outlines.get(key);
    if (hit === undefined) {
      const rings = bezierRunsToRings(subs.map((s) => ({ points: s.points, open: false })), 0.6);
      hit = rings.length > 0 ? { rings } : null;
      outlines.set(key, hit);
    }
    return hit ? { key, rings: hit.rings } : null;
  }

  if (layer.kind === 'text') {
    const spec = textPaintSpecFromLayer(layer, W, H);
    if (!spec) return null;
    /*
      Text ANIMATORS move glyphs per frame, so an animated layer re-traces on
      every frame its glyphs change (the key carries them). That used to be
      refused outright: animated text fell to the 400-slice stack, which
      rasterises the whole string per slice per frame and is no cheaper. The
      trace runs at 2x instead of 4x for animated text: a quarter of the
      pixels, ~0.8 px silhouette accuracy against a moving target nobody can
      read to the pixel. Still text drawn by the SAME painter, so a glyph an
      animator fades out leaves the solid, and one it moves takes its wall.
    */
    const animated = !!(layer.glyphs && layer.glyphs.length > 0);
    const key = `text:${textSpecKey(spec)}${animated ? `|g${hashGlyphs(layer.glyphs!)}` : ''}`;
    let hit = outlines.get(key);
    if (hit === undefined) {
      const runs = traceTextSpec(spec, animated ? 2 : 4);
      const rings = runs ? bezierRunsToRings(runs, 0.5) : [];
      hit = rings.length > 0 ? { rings } : null;
      outlines.set(key, hit);
    }
    return hit ? { key, rings: hit.rings } : null;
  }

  // Rect-shaped content: shapes, images, video, solids, precomps.
  const r = radiiOf(layer);
  const rk = typeof r === 'number' ? String(Math.round(r * 10) / 10) : r.map((v) => Math.round(v * 10) / 10).join(',');
  const key = `rect:${W}x${H}:${rk}`;
  let hit = outlines.get(key);
  if (hit === undefined) {
    hit = { rings: rectOutline(W, H, r) };
    outlines.set(key, hit);
  }
  return hit ? { key, rings: hit.rings } : null;
}

export interface ExtrusionMeshRequest {
  depth: number;
  bevel: number;
  bevelStyle: BevelProfile;
  /** Emit the (inset) front cap too — for outlines whose front the layer quad cannot inset. */
  frontCap?: boolean;
}

/**
 * The cached mesh for an outline + extrusion parameters. The returned `key`
 * is what the renderer caches GPU buffers under — it changes exactly when the
 * vertices do.
 */
export function extrusionMeshFor(
  outline: { key: string; rings: Ring[] },
  width: number,
  height: number,
  req: ExtrusionMeshRequest,
): { key: string; mesh: ExtrudedMesh } | null {
  const depth = Math.round(req.depth * 100) / 100;
  const bevel = Math.round(req.bevel * 100) / 100;
  if (depth <= 0) return null;
  const key = `${outline.key}|d${depth}|b${bevel}|${req.bevelStyle}${req.frontCap ? '|f' : ''}`;
  let mesh = meshes.get(key);
  if (mesh === undefined) {
    mesh = extrudeOutline(outline.rings, {
      depth,
      bevel,
      bevelStyle: req.bevelStyle,
      frontCap: !!req.frontCap,
      bevelSegments: req.bevelStyle === 'angular' ? 1 : 5,
      uvBox: { x: -width / 2, y: -height / 2, width, height },
    });
    meshes.set(key, mesh);
  }
  return mesh ? { key, mesh } : null;
}
