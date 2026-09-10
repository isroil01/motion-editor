/**
 * The TEXT outline the extrusion mesh is built from must turn over exactly
 * when the silhouette would. The old key covered content + eight style
 * fields, so toggling uppercase, animating a variable axis, adding a stroke
 * or resizing the layer reused the stale body under a changed front face.
 */
import { extrusionOutlineFor, clearExtrusionMeshCaches } from './extrusionMesh';
import type { RenderLayer } from '@core/rendering/RenderBackend';

const traceTextSpec = jest.fn();
jest.mock('@core/scene/shapesFromText', () => ({
  traceTextSpec: (spec: unknown, oversample?: number) => traceTextSpec(spec, oversample),
}));

const square = [
  { x: -10, y: -10, inX: -10, inY: -10, outX: -10, outY: -10 },
  { x: 10, y: -10, inX: 10, inY: -10, outX: 10, outY: -10 },
  { x: 10, y: 10, inX: 10, inY: 10, outX: 10, outY: 10 },
  { x: -10, y: 10, inX: -10, inY: 10, outX: -10, outY: 10 },
];

function textLayer(extra: Partial<RenderLayer> = {}): RenderLayer {
  return {
    id: 't', kind: 'text', text: 'Hello', fontSize: 48, fontFamily: 'Georgia', fontWeight: '700',
    x: 0, y: 0, width: 200, height: 80, opacity: 1, visible: true,
    ...extra,
  } as unknown as RenderLayer;
}

beforeEach(() => {
  clearExtrusionMeshCaches();
  traceTextSpec.mockReset();
  traceTextSpec.mockReturnValue([{ points: square, open: false }]);
});

describe('extrusionOutlineFor — text', () => {
  it('traces through the layer spec: the same box and style fields the front raster gets', () => {
    const out = extrusionOutlineFor(textLayer({ textTransform: 'uppercase', textStrokeWidth: 4, align: 'left' }), undefined, 200, 80);
    expect(out).not.toBeNull();
    expect(traceTextSpec).toHaveBeenCalledTimes(1);
    const spec = traceTextSpec.mock.calls[0]![0] as Record<string, unknown>;
    expect(spec).toMatchObject({
      text: 'Hello', fontFamily: 'Georgia', fontWeight: '700', width: 200, height: 80,
      textTransform: 'uppercase', textStrokeWidth: 4, align: 'left', color: '#ffffff',
    });
  });

  it('caches by silhouette: an unchanged layer never re-traces', () => {
    const a = extrusionOutlineFor(textLayer(), undefined, 200, 80);
    const b = extrusionOutlineFor(textLayer(), undefined, 200, 80);
    expect(a!.key).toBe(b!.key);
    expect(traceTextSpec).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['textTransform', { textTransform: 'uppercase' }],
    ['fontWidth (variable axis)', { fontWidth: 75 }],
    ['textStrokeWidth', { textStrokeWidth: 6 }],
    ['verticalScale', { verticalScale: 150 }],
    ['baselineShift', { baselineShift: 10 }],
    ['align', { align: 'right' }],
    ['runs', { runs: [{ start: 0, end: 2, fontWeight: '400' }] }],
    ['textPath', { textPath: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], closed: false, firstMargin: 0, reversed: false, perpendicular: true } }],
  ])('re-traces when %s changes', (_name, patch) => {
    const a = extrusionOutlineFor(textLayer(), undefined, 200, 80);
    const b = extrusionOutlineFor(textLayer(patch as Partial<RenderLayer>), undefined, 200, 80);
    expect(a!.key).not.toBe(b!.key);
    expect(traceTextSpec).toHaveBeenCalledTimes(2);
  });

  it('re-traces when the layer box changes (the box is the mesh uv frame)', () => {
    const a = extrusionOutlineFor(textLayer(), undefined, 200, 80);
    const b = extrusionOutlineFor(textLayer(), undefined, 260, 80);
    expect(a!.key).not.toBe(b!.key);
  });

  it('traces animated text too, at the cheaper oversample', () => {
    // Animators used to be refused outright, which dropped the layer onto the
    // 400-slice stack — no cheaper, and not a solid.
    const out = extrusionOutlineFor(textLayer({ glyphs: [{ dx: 0, dy: 0, scale: 1, scaleY: 1, rotation: 0, opacity: 1, fillOpacity: 1, tracking: 0, lineSpacing: 0, blur: 0, skew: 0 }] as never }), undefined, 200, 80);
    expect(out).not.toBeNull();
    expect(traceTextSpec).toHaveBeenCalledWith(expect.anything(), 2);
  });

  it('re-traces when the animator output moves a glyph, and not when it repeats', () => {
    const glyph = (dx: number) => ({ dx, dy: 0, scale: 1, scaleY: 1, rotation: 0, opacity: 1, fillOpacity: 1, tracking: 0, lineSpacing: 0, blur: 0, skew: 0 });
    const a = extrusionOutlineFor(textLayer({ glyphs: [glyph(0)] as never }), undefined, 200, 80);
    const same = extrusionOutlineFor(textLayer({ glyphs: [glyph(0)] as never }), undefined, 200, 80);
    const moved = extrusionOutlineFor(textLayer({ glyphs: [glyph(12)] as never }), undefined, 200, 80);
    expect(a!.key).toBe(same!.key);
    expect(a!.key).not.toBe(moved!.key);
    expect(traceTextSpec).toHaveBeenCalledTimes(2);
  });

  it('returns null when the trace has nothing (headless)', () => {
    traceTextSpec.mockReturnValue(null);
    expect(extrusionOutlineFor(textLayer(), undefined, 200, 80)).toBeNull();
  });
});
