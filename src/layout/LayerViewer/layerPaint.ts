/**
 * layerPaint — the stroke the Layer panel's paint brush writes. Pure, so the
 * pointer plumbing stays thin and this is testable without a canvas.
 *
 * The Layer panel shows the layer UNTRANSFORMED, so its points are already in
 * the layer's own space (centred, as `PaintStroke` stores them) and the brush
 * size is layer pixels as-is — AE's Layer-panel painting. The comp viewer has
 * to convert both through the layer's transform (`compToLayerLocal`,
 * `localBrushSize`); here there is nothing to convert.
 */

import type { PaintMode, PaintStroke } from '@core/paint/paintStrokes';

export type LayerPaintTool = 'paint' | 'eraser';

export interface LayerPaintSettings {
  tool: LayerPaintTool;
  /** The Paint panel's mode (paint / clone); the eraser always erases. */
  mode: PaintMode;
  color: string;
  size: number;
  opacity: number;
  hardness: number;
  /** Clone source in layer space, set by Alt-click. */
  cloneSource: { x: number; y: number } | null;
}

type Pt = { x: number; y: number };

/** Add a point unless it is sub-pixel jitter from the last one. */
export function appendPoint(points: ReadonlyArray<Pt>, p: Pt, minDist = 0.5): Pt[] {
  const last = points[points.length - 1];
  if (last && Math.hypot(p.x - last.x, p.y - last.y) < minDist) return [...points];
  return [...points, p];
}

/**
 * The stroke to write for a finished drag, or null when there is nothing to
 * write (no points, or a clone stroke with no source to sample from).
 */
export function paintStrokeFrom(
  points: ReadonlyArray<Pt>,
  s: LayerPaintSettings,
): (Partial<PaintStroke> & { points: ReadonlyArray<Pt> }) | null {
  if (points.length === 0) return null;
  const mode: PaintMode = s.tool === 'eraser' ? 'erase' : s.mode;
  if (mode === 'clone' && !s.cloneSource) return null;
  const first = points[0]!;
  return {
    points: points.map((p) => ({ x: p.x, y: p.y })),
    color: s.color,
    size: s.size,
    opacity: s.opacity,
    hardness: s.hardness,
    mode,
    // Classic clone-stamp aiming: offset = source − first dab.
    ...(mode === 'clone' && s.cloneSource
      ? { cloneOffsetX: s.cloneSource.x - first.x, cloneOffsetY: s.cloneSource.y - first.y }
      : {}),
  };
}
