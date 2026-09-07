/**
 * Create Shapes From Text — a text layer's glyphs as an editable shape layer.
 *
 * AE's Layer ▸ Create Shapes from Text. The new layer is a path layer whose
 * Geometry carries one closed run per glyph contour — outer rings and the
 * counters of letters like O and A as holes — positioned to coincide with the
 * text layer, which is hidden rather than deleted (AE keeps it too).
 *
 * ## Where the outlines come from
 *
 * From the FONT when it can be read: the installed face is opened through the
 * Local Font Access API and its `glyf` or CFF outlines are parsed
 * (`openType.ts`), laid out to match the rasteriser (`fontOutlines.ts`). Those
 * are the font's own Béziers — as few anchors as the designer drew.
 *
 * When the face cannot be read — a web font, or local-font permission refused
 * — the text is rasterised at 4× and TRACED (`traceBitmap`) then smoothed. The
 * result looks like the glyph but has more anchors than the font's data, so
 * the layer's name says which path produced it: "(outlines)" or "(traced)". A
 * traced outline presented as a font outline would mislead the next person to
 * twirl it open.
 */

import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { readNodeKind } from '@core/scene/sceneDerive';
import { readMeasuredTextStyle, measureTextBoxes, measureTextSize } from '@core/text/measureText';
import { paintTextInBox, type TextPaintSpec } from '@core/rendering/raster/textPaint';
import { useSelectionStore } from '@stores/selectionStore';
import { bumpScene } from '@stores/sceneStore';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';
import { traceBitmap, smoothContour, type TracedContour } from '@core/geometry/traceBitmap';
import { loadLocalFace, outlineRuns } from '@core/text/fontOutlines';
import type { SceneNode } from '@core/types';

/** Oversampling factor for the trace. 4× is where staircase artefacts stop
 *  being visible at 1× after smoothing, and an 80 px glyph is still a 320 px
 *  raster — cheap. */
const OVERSAMPLE = 4;

interface BPt { x: number; y: number; inX: number; inY: number; outX: number; outY: number }

/**
 * Rasterise a text spec EXACTLY as the layer's own texture is drawn — the
 * same painter (`paintTextInBox`), the same box, the same origin — at 4×,
 * as a white silhouette (fill and stroke both white, so the layer stroke is
 * part of the outline the way it is part of the pixels).
 *
 * The raster is the layer box (`spec.width × spec.height`) scaled by
 * OVERSAMPLE; its centre is the layer's centre. Null when there is no canvas
 * to draw with (headless).
 */
function rasterizeTextSpec(spec: TextPaintSpec, oversample: number): { alpha: Uint8ClampedArray; w: number; h: number; scale: number } | null {
  if (typeof document === 'undefined') return null;
  if (!(spec.text ?? '').trim()) return null;
  const w = Math.ceil(spec.width * oversample);
  const h = Math.ceil(spec.height * oversample);
  if (w < 2 || h < 2) return null;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.scale(oversample, oversample);
  paintTextInBox(g, { ...spec, color: '#ffffff', textStroke: '#ffffff' });
  const img = g.getImageData(0, 0, w, h);
  return { alpha: img.data, w, h, scale: oversample };
}

/**
 * The paint spec for a text NODE — the same fields buildSnapshot puts on the
 * render layer and MotionRendererBackend feeds the texture provider, read
 * straight off the components. For Create Shapes From Text, which has a node
 * and no render layer; the render snapshot builds its spec from the layer.
 */
export function textPaintSpecFromNode(node: SceneNode): TextPaintSpec | null {
  const style = readMeasuredTextStyle(node);
  if (!style || !style.content.trim()) return null;
  const size = measureTextSize(style);
  if (!size) return null;
  let align: string | undefined;
  let textStroke: string | undefined;
  let textStrokeWidth: number | undefined;
  let strokeOverFill: boolean | undefined;
  for (const c of node.components) {
    const p = c.props as Record<string, unknown>;
    if (typeof p.align === 'string') align = p.align;
    if (typeof p.textStroke === 'string') textStroke = p.textStroke;
    if (typeof p.textStrokeWidth === 'number') textStrokeWidth = p.textStrokeWidth;
    if (typeof p.strokeOverFill === 'boolean') strokeOverFill = p.strokeOverFill;
  }
  return {
    text: style.content,
    fontSize: style.fontSize,
    color: '#ffffff',
    width: size.w,
    height: size.h,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontWidth: style.fontWidth,
    fontSlant: style.fontSlant,
    fontStyle: style.fontStyle,
    align,
    letterSpacing: style.letterSpacing,
    lineHeight: style.lineHeight,
    paragraphSpacing: style.paragraphSpacing,
    textTransform: style.textTransform,
    fontVariant: style.fontVariant,
    verticalAlign: style.verticalAlign,
    verticalScale: style.verticalScale,
    horizontalScale: style.horizontalScale,
    baselineShift: style.baselineShift,
    textStroke,
    textStrokeWidth,
    strokeOverFill,
  };
}

/** Trace, smooth, and express contours in LAYER space (centre-origin, 1×). */
function contoursToRuns(
  contours: ReadonlyArray<TracedContour>,
  cx: number,
  cy: number,
  scale: number,
): Array<{ points: BPt[]; open: false }> {
  return contours
    .filter((c) => c.points.length >= 3)
    .map((c) => ({
      open: false as const,
      points: smoothContour(
        c.points.map((p) => ({ x: (p.x - cx) / scale, y: (p.y - cy) / scale })),
        0.55,
      ),
    }));
}

export function canCreateShapesFromText(nodeId: string): boolean {
  const node = defaultSceneGraph.getNode(nodeId);
  return !!node && readNodeKind(node) === 'text' && !!readMeasuredTextStyle(node)?.content.trim();
}

/** The font's own outlines, or null when the face cannot be read. */
async function fontRuns(node: SceneNode): Promise<{ runs: Array<{ points: BPt[]; open: false }>; w: number; h: number } | null> {
  if (typeof document === 'undefined') return null;
  const style = readMeasuredTextStyle(node);
  if (!style || !style.content.trim()) return null;
  const face = await loadLocalFace(style.fontFamily, Number(style.fontWeight) || 400, style.fontStyle === 'italic');
  if (!face) return null;
  const boxes = measureTextBoxes(style);
  if (!boxes) return null;
  const g = document.createElement('canvas').getContext('2d');
  if (!g) return null;
  const fontStyle = style.fontStyle === 'italic' ? 'italic ' : '';
  g.font = `${fontStyle}${style.fontWeight} ${style.fontSize}px "${style.fontFamily}", Inter, system-ui, sans-serif`;
  g.textBaseline = 'middle';
  const runs = outlineRuns(style, boxes, face, g);
  if (runs.length === 0) return null;
  // The LAYER box, so the shape layer's box is the text layer's box.
  const size = measureTextSize(style);
  if (!size) return null;
  return { runs, w: size.w, h: size.h };
}

/**
 * Trace a text spec's silhouette into closed Bézier runs in LAYER space —
 * centre-origin, 1×, the origin being the box centre the layer's texture is
 * drawn around. Synchronous, so the render snapshot can build an extrusion
 * mesh from it. Null without a canvas (headless) or for empty text.
 */
export function traceTextSpec(spec: TextPaintSpec, oversample: number = OVERSAMPLE): Array<{ points: BPt[]; open: false }> | null {
  const raster = rasterizeTextSpec(spec, oversample);
  if (!raster) return null;
  const contours = traceBitmap(raster.alpha, raster.w, raster.h, 4, {
    threshold: 128,
    // Tolerance in RASTER pixels: ~0.4 px at 1× whatever the oversample —
    // well under what smoothing then rounds away.
    tolerance: 0.375 * oversample,
    minArea: 6 * oversample,
  });
  const runs = contoursToRuns(contours, raster.w / 2, raster.h / 2, raster.scale);
  return runs.length > 0 ? runs : null;
}

/** The traced outlines — the fallback when the font cannot be read. */
function tracedRuns(node: SceneNode): { runs: Array<{ points: BPt[]; open: false }>; w: number; h: number } | null {
  const spec = textPaintSpecFromNode(node);
  if (!spec) return null;
  const runs = traceTextSpec(spec);
  if (!runs) return null;
  return { runs, w: spec.width, h: spec.height };
}

/** A text node's traced outlines in layer space (see `traceTextSpec`). */
export function traceTextRuns(node: SceneNode): Array<{ points: BPt[]; open: false }> | null {
  return tracedRuns(node)?.runs ?? null;
}

export type ShapesFromTextSource = 'outlines' | 'traced';

/**
 * Create the shape layer beside the text layer and hide the original.
 * Resolves to the new layer's id and which source produced it, or null when
 * the text could not be outlined at all.
 */
export async function createShapesFromText(nodeId: string): Promise<{ id: string; source: ShapesFromTextSource } | null> {
  const node = defaultSceneGraph.getNode(nodeId);
  if (!node || readNodeKind(node) !== 'text') return null;
  const style = readMeasuredTextStyle(node);
  const spec = textPaintSpecFromNode(node);
  // Installed-face outlines do not apply `wdth`/`slnt`, and `outlineRuns`
  // lays out plain centred lines: no case transform, small caps, scale,
  // baseline shift, stroke, or left/right alignment. When the author set any
  // of those, prefer the trace — which is painted by the layer's own
  // rasteriser and so has them all — over a misleading default outline.
  const wantsVariations = style != null
    && ((style.fontWidth !== undefined && Number.isFinite(style.fontWidth))
      || (style.fontSlant !== undefined && Number.isFinite(style.fontSlant)));
  const wantsPaintedLayout = spec != null && (
    !!spec.textTransform || !!spec.fontVariant || !!spec.verticalAlign
    || spec.verticalScale !== undefined || spec.horizontalScale !== undefined || spec.baselineShift !== undefined
    || (spec.textStrokeWidth ?? 0) > 0
    || (spec.align !== undefined && spec.align !== 'center' && spec.text.includes('\n'))
  );
  let source: ShapesFromTextSource = 'outlines';
  let built = wantsVariations || wantsPaintedLayout ? null : await fontRuns(node);
  if (!built) {
    source = 'traced';
    built = tracedRuns(node);
  }
  if (!built) return null;
  const { runs } = built;

  const t = node.components.find((c) => c.type === 'Transform')?.props as Record<string, unknown> | undefined;
  const styleComp = node.components.find((c) => c.type === 'Style' || c.type === 'Text')?.props as Record<string, unknown> | undefined;
  const num = (v: unknown, fb: number): number => (typeof v === 'number' ? v : fb);
  const id = `shape_from_text_${nodeId}_${Date.now().toString(36)}`;
  const parent = node.parent ?? 'comp_root';
  const fill = typeof styleComp?.fill === 'string' ? (styleComp.fill as string) : '#ffffff';

  const shape: SceneNode = {
    id,
    name: `${node.name ?? 'Text'} Outlines (${source})`,
    parent,
    children: [],
    transform: {
      position: { x: num(t?.x, 0), y: num(t?.y, 0) },
      rotation: num(t?.rotation, 0),
      scale: { x: num(t?.scaleX, 1), y: num(t?.scaleY, 1) },
    },
    visible: true,
    locked: false,
    components: [
      {
        id: `${id}_t`,
        type: 'Transform',
        props: {
          [SCENE_KIND_PROP]: 'shape',
          x: num(t?.x, 0), y: num(t?.y, 0), rotation: num(t?.rotation, 0),
          scaleX: num(t?.scaleX, 1), scaleY: num(t?.scaleY, 1),
          width: built.w, height: built.h,
          shapeType: 'path',
        },
      },
      { id: `${id}_s`, type: 'Style', props: { fill, opacity: num(styleComp?.opacity, 100) } },
      // Runs, never the flat point list: a letter with a counter is two runs,
      // and the flat form is "what filled every donut's hole" (sceneInsert).
      { id: `${id}_g`, type: 'Geometry', props: { subpaths: runs } },
    ],
  };
  defaultSceneGraph.addChild(parent, shape);
  // AE hides the source text layer rather than deleting it; the shapes are a
  // derivative and the text is still the editable truth.
  const src = defaultSceneGraph.getNode(nodeId);
  if (src) src.visible = false;
  useSelectionStore.getState().set([id]);
  bumpScene();
  return { id, source };
}
