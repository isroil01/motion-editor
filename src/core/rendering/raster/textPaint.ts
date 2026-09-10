/**
 * The text layout + paint that both text rasters share.
 *
 * ONE painter, two consumers:
 *   • `Canvas2DVectorRasterizer.drawText` — the layer's front raster (its
 *     texture);
 *   • `shapesFromText.traceTextSpec` — the 4× silhouette that becomes the
 *     3D extrusion body and Create Shapes From Text.
 *
 * They used to be two hand-kept copies of the same layout. The trace copy
 * centred on the INK box while the raster centred on the box origin, laid
 * letter-spaced glyphs by hand (unkerned) while the raster used the canvas's
 * own `letterSpacing`, and knew nothing of case, small caps, scale, baseline
 * shift, the layer stroke, per-run styles or text-on-path. Every one of those
 * put the extruded body somewhere the front face was not — a title with a
 * descender sat ~22 px high on its own solid, and a letter-spaced one drifted
 * off it letter by letter.
 *
 * Draws in the UNPADDED box: (0,0)–(width,height), the draw origin at the
 * box centre. The caller sets any supersample / padding transform first.
 * `spec.color` is the fill; a caller that wants a silhouette passes white for
 * both `color` and `textStroke`.
 */

import { layoutText } from '@core/text/textLayout';
import { applyTextCase, textStyleTransform } from '@core/text/measureText';
import { applyTextPath } from '@core/text/textPath';
import { arcTable } from '@core/scene/trimPath';
import { mixHex } from '@core/text/textAnimators';
import { textCssFont, textFontVariationSettings } from '../AppTextureProvider';
import type { TextSpec } from '../AppTextureProvider';

/** The fields the painter reads. `TextSpec` satisfies it; so does a RenderLayer-derived subset. */
export type TextPaintSpec = Pick<
  TextSpec,
  | 'text' | 'fontSize' | 'color' | 'width' | 'height'
  | 'fontFamily' | 'fontWeight' | 'fontWidth' | 'fontSlant' | 'fontStyle'
  | 'align' | 'letterSpacing' | 'lineHeight' | 'paragraphSpacing'
  | 'strokeOverFill' | 'textTransform' | 'fontVariant' | 'verticalAlign'
  | 'verticalScale' | 'horizontalScale' | 'baselineShift'
  | 'textStroke' | 'textStrokeWidth' | 'runs' | 'glyphs' | 'textPath'
>;

export function paintTextInBox(ctx: CanvasRenderingContext2D, spec: TextPaintSpec): void {
  // Character panel: horizontal/vertical scale, baseline shift and
  // super/subscript are ONE affine transform about the box centre, applied
  // before any glyph is laid out so both draw paths below inherit it.
  {
    const tr = textStyleTransform(spec);
    if (tr.sx !== 1 || tr.sy !== 1 || tr.dy !== 0) {
      ctx.translate(spec.width / 2, spec.height / 2 + tr.dy);
      ctx.scale(tr.sx, tr.sy);
      ctx.translate(-spec.width / 2, -spec.height / 2);
    }
  }
  ctx.font = textCssFont(spec);
  {
    const vars = textFontVariationSettings(spec);
    if (vars) (ctx as CanvasRenderingContext2D & { fontVariationSettings?: string }).fontVariationSettings = vars;
    // Small caps is a font FEATURE, not a font shorthand token Canvas accepts.
    const caps = ctx as CanvasRenderingContext2D & { fontVariantCaps?: string };
    if ('fontVariantCaps' in caps) caps.fontVariantCaps = spec.fontVariant === 'small-caps' ? 'small-caps' : 'normal';
  }
  ctx.textBaseline = 'middle';
  ctx.letterSpacing = spec.letterSpacing ? `${spec.letterSpacing}px` : '0px';
  ctx.fillStyle = spec.color;

  const text = applyTextCase(spec.text || 'Text', spec.textTransform);
  // The layer's own stroke (Character panel), drawn under or over the fill
  // per `strokeOverFill`. Zero width = no stroke, the default.
  const layerStrokeW = typeof spec.textStrokeWidth === 'number' && spec.textStrokeWidth > 0 ? spec.textStrokeWidth : 0;
  const layerStrokeColor = typeof spec.textStroke === 'string' && spec.textStroke ? spec.textStroke : spec.color;
  const strokeLine = (line: string, x: number, y: number): void => {
    if (layerStrokeW <= 0) return;
    ctx.lineWidth = layerStrokeW;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = layerStrokeColor;
    ctx.strokeText(line, x, y);
  };

  const hasGlyphWork =
    (spec.runs && spec.runs.length > 0) ||
    (spec.glyphs && spec.glyphs.length > 0) ||
    !!spec.textPath;

  if (!hasGlyphWork) {
    const size = spec.fontSize;
    const align = spec.align ?? 'left';
    const padX = 12;
    let anchorX = spec.width / 2;
    if (align === 'left' || align === 'justify') { ctx.textAlign = 'left'; anchorX = padX; }
    else if (align === 'right') { ctx.textAlign = 'right'; anchorX = spec.width - padX; }
    else { ctx.textAlign = 'center'; anchorX = spec.width / 2; }

    const lines = text.split('\n');
    const lh = (spec.lineHeight ?? 1.2) * size;
    const gap = lh + (spec.paragraphSpacing ?? 0);
    const startY = spec.height / 2 - ((lines.length - 1) * gap) / 2;
    lines.forEach((line: string, i: number) => {
      const y = startY + i * gap;
      if (layerStrokeW > 0 && !spec.strokeOverFill) strokeLine(line, anchorX, y);
      ctx.fillStyle = spec.color;
      ctx.fillText(line, anchorX, y);
      if (layerStrokeW > 0 && spec.strokeOverFill) strokeLine(line, anchorX, y);
    });
    return;
  }

  ctx.letterSpacing = '0px';
  const measureCache = new Map<string, number>();
  const measure: any = (char: string, style: any) => {
    const font = textCssFont(style);
    const key = `${font} ${char}`;
    const hit = measureCache.get(key);
    if (hit !== undefined) return hit;
    ctx.font = font;
    const width = ctx.measureText(char).width;
    measureCache.set(key, width);
    return width;
  };

  const laid = layoutText(
    text,
    {
      fontSize: spec.fontSize,
      fontFamily: spec.fontFamily,
      fontWeight: spec.fontWeight,
      fontStyle: spec.fontStyle,
      letterSpacing: spec.letterSpacing,
      fill: spec.color,
      align: spec.align,
      lineHeight: spec.lineHeight,
      paragraphSpacing: spec.paragraphSpacing,
    },
    measure,
    {
      runs: spec.runs,
      transforms: spec.glyphs,
      boxWidth: spec.width,
      // Kerned measurement, so this per-glyph path lands on exactly the same
      // pixels as the whole-string fast path above. Without it the two
      // disagreed by 8px over a 19-character headline, and any frame that
      // composited both showed the string twice at two spacings — a picket
      // fence of 1px vertical bars through the letterforms.
      measureRun: (run: string, style: any) => {
        const font = textCssFont(style);
        const key = `run|${font}|${style.letterSpacing ?? 0}|${run}`;
        const hit = measureCache.get(key);
        if (hit !== undefined) return hit;
        // Spacing ON for this measurement: the advance it returns is what the
        // fast path would actually produce.
        ctx.letterSpacing = style.letterSpacing ? `${style.letterSpacing}px` : '0px';
        ctx.font = font;
        const w = ctx.measureText(run).width;
        ctx.letterSpacing = '0px';
        measureCache.set(key, w);
        return w;
      },
    },
  );

  const placed = spec.textPath
    ? applyTextPath(laid, {
        table: arcTable(spec.textPath.points, spec.textPath.closed),
        firstMargin: spec.textPath.firstMargin,
        reversed: spec.textPath.reversed,
        perpendicular: spec.textPath.perpendicular,
        align: spec.align,
      })
    : laid.glyphs;

  ctx.textAlign = 'center';
  const cx = spec.width / 2;
  const cy = spec.height / 2;
  for (const g of placed) {
    const tr = g.transform;
    const ch = tr?.displayChar ?? g.char;
    if (ch.trim() === '') continue;

    // The cheap path stays cheap: a glyph with no animator transform and no
    // path angle draws exactly as it did before, with no save/restore.
    const plain = !tr && g.angle === undefined && layerStrokeW <= 0;
    if (plain) {
      ctx.font = textCssFont(g.style);
      ctx.fillStyle = g.style.fill ?? spec.color;
      // Centred on the glyph's own advance box (`PlacedGlyph.x` is that
      // centre). Drawing left-aligned from `x - inkWidth / 2` was tried and is
      // the identical span, so it changed nothing — measured, both give 42 ink
      // runs. The residual difference against the whole-string path is font
      // SHAPING (ligatures, contextual alternates), which no amount of
      // positioning reproduces glyph-by-glyph.
      ctx.fillText(ch, cx + g.x, cy + g.y);
      continue;
    }

    ctx.save();
    // Order matters and mirrors AE: translate to the glyph's own origin,
    // then rotate / skew / scale ABOUT it, so a rotating character spins in
    // place rather than swinging around the layer's anchor.
    ctx.translate(cx + g.x + (tr?.dx ?? 0), cy + g.y + (tr?.dy ?? 0) + (tr?.lineSpacing ?? 0) * g.line);
    if (g.angle) ctx.rotate(g.angle);
    if (tr) {
      if (tr.rotation) ctx.rotate((tr.rotation * Math.PI) / 180);
      if (tr.skew) ctx.transform(1, 0, Math.tan((-tr.skew * Math.PI) / 180), 1, 0, 0);
      if (tr.scale !== 1 || tr.scaleY !== 1) ctx.scale(tr.scale, tr.scaleY);
      // Opacity multiplies the layer's own — an animator fading a character
      // to 0 must not brighten a layer that is already half transparent.
      if (tr.opacity !== 1) ctx.globalAlpha = ctx.globalAlpha * Math.max(0, tr.opacity);
      if (tr.blur > 0) ctx.filter = `blur(${tr.blur}px)`;
    }

    ctx.font = textCssFont(g.style);
    const baseFill = g.style.fill ?? spec.color;
    const fill =
      tr?.color && (tr.colorMix ?? 0) > 0
        ? mixHex(baseFill, tr.color, tr.colorMix ?? 1)
        : baseFill;

    // AE's Fill & Stroke order, per layer. UNDER is the default: a stroke
    // centres on the outline, so painting it over the fill eats half its
    // width out of the glyph and an animated stroke appears to thin the
    // letterforms. Over is still worth having — it is how you get a hard
    // outline that stays crisp against a busy background.
    const strokeGlyph = (): void => {
      // An animator's stroke wins; otherwise the layer's own.
      const w = tr && tr.strokeWidth > 0 ? tr.strokeWidth : layerStrokeW;
      if (w <= 0) return;
      ctx.lineWidth = w;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = tr && tr.strokeWidth > 0 ? (tr.strokeColor ?? fill) : layerStrokeColor;
      ctx.strokeText(ch, 0, 0);
    };
    const fillGlyph = (): void => {
      const fillAlpha = tr ? Math.max(0, tr.fillOpacity) : 1;
      if (fillAlpha <= 0) return;
      const prev = ctx.globalAlpha;
      if (fillAlpha < 1) ctx.globalAlpha = prev * fillAlpha;
      ctx.fillStyle = fill;
      ctx.fillText(ch, 0, 0);
      ctx.globalAlpha = prev;
    };

    if (spec.strokeOverFill) {
      fillGlyph();
      strokeGlyph();
    } else {
      strokeGlyph();
      fillGlyph();
    }
    ctx.restore();
  }
}
