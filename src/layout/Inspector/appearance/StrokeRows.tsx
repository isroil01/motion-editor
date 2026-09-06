/**
 * The Stroke half of the Fill & Stroke section: the switch, width, colour,
 * opacity, align / cap / join, dash and offset, AE's Taper and Wave group,
 * the gradient paint with its stop list, and the extra strokes.
 *
 * Split out of `AppearanceSection.tsx` (2026-09-04); the markup and every
 * write path are what the section drew inline. The scalar rows — width, dash
 * offset, the taper and wave numbers — are the one thing that changed: each
 * is a per-node accessor, so a width drag with three strokes selected
 * offsets all three and the row reads `—` where they disagree. A layer whose
 * stroke is switched off has no such value and is left alone.
 */

import { ValueField } from '@components/ValueField';
import { Icon } from '@components/Icon';
import { ColorPicker } from '@components/ColorPicker';
import { Checkbox } from '@components/Checkbox';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { defaultAnimation } from '@motion/animation';
import { convertFill, type FillType } from '@core/paint/fill';
import {
  IDENTITY_TAPER as TAPER_DEFAULTS,
  IDENTITY_WAVE as WAVE_DEFAULTS,
  isIdentityTaper,
  isIdentityWave,
  type StrokeTaper,
  type StrokeWave,
} from '@core/scene/strokeProfile';
import {
  getNodeStroke,
  updateNodeStroke,
  getNodeStrokes,
  setNodeStrokes,
  defaultStroke,
  normalizeStroke,
  type Stroke,
  type StrokeAlign,
  type StrokeCap,
  type StrokeJoin,
} from '@core/paint/stroke';
import type { PropertyAccess } from '@core/inspector/multiSelection';
import { ColorKfRow } from '../ColorKfRow';
import { AnimatablePaintRow } from './AnimatablePaintRow';
import { StopList } from './StopLists';
import styles from '../TransformSection.module.css';
import effStyles from '../../Effects/EffectsPanel.module.css';

/**
 * Patch the taper, SEEDING a ramp when the edit would otherwise be identity.
 *
 * Found by driving the real UI: a width alone cannot leave identity, because
 * identity needs BOTH a non-full width and a ramp length. So setting "Taper
 * Start = 60%" with the default zero length normalised straight back to
 * undefined and the field snapped to 100 — a control that could not be moved,
 * which is worse than one that is missing.
 *
 * The model stays honest (identity IS identity, and is dropped so it cannot
 * bloat the raster cache key); this is the UI affordance that makes the first
 * edit do something. AE reaches the same place by shipping a non-zero default
 * length once the group is added.
 */
const DEFAULT_RAMP = 0.5;
function patchTaper(nodeId: string, patch: Partial<StrokeTaper>): void {
  const stroke = getNodeStroke(nodeId);
  const next = { ...TAPER_DEFAULTS, ...stroke?.taper, ...patch };
  if (next.startWidth < 1 && next.startLength <= 0 && patch.startLength === undefined) next.startLength = DEFAULT_RAMP;
  if (next.endWidth < 1 && next.endLength <= 0 && patch.endLength === undefined) next.endLength = DEFAULT_RAMP;
  updateNodeStroke(nodeId, { taper: next });
}

/** Same trap on the wave: an amplitude with no wavelength is identity. */
const DEFAULT_WAVELENGTH = 60;
function patchWave(nodeId: string, patch: Partial<StrokeWave>): void {
  const stroke = getNodeStroke(nodeId);
  const next = { ...WAVE_DEFAULTS, ...stroke?.wave, ...patch };
  if (next.amount !== 0 && next.wavelength <= 0 && patch.wavelength === undefined) next.wavelength = DEFAULT_WAVELENGTH;
  updateNodeStroke(nodeId, { wave: next });
}

/** An enabled stroke on the node, or nothing — a disabled stroke has no scalar to edit. */
function enabledStroke(nodeId: string): Stroke | undefined {
  const s = getNodeStroke(nodeId);
  return s?.enabled ? s : undefined;
}

/**
 * Per-node accessors for the stroke scalars, built once so their identity is
 * stable (the row memoises its aggregate on them).
 */
function strokeAccess(read: (s: Stroke) => number, write: (nodeId: string, v: number) => void): PropertyAccess {
  return {
    read: (id) => {
      const s = enabledStroke(id);
      return s ? read(s) : undefined;
    },
    writeStatic: (id, v) => {
      if (!enabledStroke(id)) return false;
      write(id, v);
      return true;
    },
  };
}

const STROKE_ACCESS = {
  width: strokeAccess((s) => s.width, (id, width) => updateNodeStroke(id, { width, enabled: width > 0 })),
  dashOffset: strokeAccess((s) => s.dashOffset ?? 0, (id, dashOffset) => updateNodeStroke(id, { dashOffset })),
  taperStartWidth: strokeAccess((s) => s.taper?.startWidth ?? 1, (id, v) => patchTaper(id, { startWidth: v })),
  taperEndWidth: strokeAccess((s) => s.taper?.endWidth ?? 1, (id, v) => patchTaper(id, { endWidth: v })),
  taperStartLength: strokeAccess((s) => s.taper?.startLength ?? 0, (id, v) => patchTaper(id, { startLength: v })),
  taperEndLength: strokeAccess((s) => s.taper?.endLength ?? 0, (id, v) => patchTaper(id, { endLength: v })),
  taperStartEase: strokeAccess((s) => s.taper?.startEase ?? 0, (id, v) => patchTaper(id, { startEase: v })),
  taperEndEase: strokeAccess((s) => s.taper?.endEase ?? 0, (id, v) => patchTaper(id, { endEase: v })),
  waveAmount: strokeAccess((s) => s.wave?.amount ?? 0, (id, v) => patchWave(id, { amount: v })),
  waveWavelength: strokeAccess((s) => s.wave?.wavelength ?? 0, (id, v) => patchWave(id, { wavelength: v })),
  wavePhase: strokeAccess((s) => s.wave?.phase ?? 0, (id, v) => patchWave(id, { phase: v })),
} as const;

export function StrokeRows({ nodeId }: { nodeId: string }): JSX.Element | null {
  if (!defaultSceneGraph.getNode(nodeId)) return null;

  const stroke = getNodeStroke(nodeId);
  const hasTaper = !isIdentityTaper(stroke?.taper);
  const hasWave = !isIdentityWave(stroke?.wave);
  const strokes = getNodeStrokes(nodeId);

  const handleStrokeColorChange = (color: string) => {
    updateNodeStroke(nodeId, { color });
  };

  const handleStrokeCapChange = (cap: StrokeCap) => {
    updateNodeStroke(nodeId, { cap });
  };

  const handleStrokeJoinChange = (join: StrokeJoin) => {
    updateNodeStroke(nodeId, { join });
  };

  const handleStrokeAlignChange = (align: StrokeAlign) => {
    updateNodeStroke(nodeId, { align });
  };

  const handleStrokeOpacityChange = (v: number) => {
    updateNodeStroke(nodeId, { opacity: v / 100 });
  };

  const handleStrokeDashChange = (raw: string) => {
    updateNodeStroke(nodeId, {
      dash: raw.split(',').map((n) => Number.parseFloat(n.trim())).filter((n) => Number.isFinite(n) && n >= 0),
    });
  };

  const isStrokeAnimated = defaultAnimation.isAnimated(nodeId, 'stroke') || defaultAnimation.isAnimated(nodeId, 'stroke_r') || defaultAnimation.isAnimated(nodeId, 'stroke_g') || defaultAnimation.isAnimated(nodeId, 'stroke_b');

  return (
    <>
        <div className={styles.subhead} style={{ marginTop: 10 }}>
          Stroke
          {isStrokeAnimated && <span className={styles.animatedDot} />}
        </div>
            <div className={styles.popoverRow}>
              <span className={styles.popoverLabel}>Enabled</span>
              <Checkbox
                checked={stroke?.enabled ?? false}
                onChange={() => updateNodeStroke(nodeId, { enabled: !(stroke?.enabled ?? false) })}
              />
            </div>

            {(stroke?.enabled ?? false) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <AnimatablePaintRow nodeId={nodeId} prop="strokeWidth" label="Width" access={STROKE_ACCESS.width} />

                <ColorKfRow
                  nodeId={nodeId}
                  propPrefix="stroke"
                  label="Color"
                  value={stroke?.color ?? '#ffffff'}
                  setValue={handleStrokeColorChange}
                />

                <div className={styles.popoverRow}>
                  <span className={styles.popoverLabel}>Opacity</span>
                  <ValueField
                    value={Math.round((stroke?.opacity ?? 1) * 100)}
                    min={0} max={100} precision={0} unit="%"
                    onChange={handleStrokeOpacityChange}
                  />
                </div>

                <div className={styles.popoverRow}>
                  <span className={styles.popoverLabel}>Align</span>
                  <select
                    value={stroke?.align ?? 'center'}
                    onChange={(e) => handleStrokeAlignChange(e.target.value as StrokeAlign)}
                    className={styles.select}
                    style={{ width: 100 }}
                  >
                    <option value="center">Center</option>
                    <option value="inside">Inside</option>
                    <option value="outside">Outside</option>
                  </select>
                </div>

                <div className={styles.popoverRow}>
                  <span className={styles.popoverLabel}>Cap</span>
                  <select
                    value={stroke?.cap ?? 'round'}
                    onChange={(e) => handleStrokeCapChange(e.target.value as StrokeCap)}
                    className={styles.select}
                    style={{ width: 100 }}
                  >
                    <option value="butt">Butt</option>
                    <option value="round">Round</option>
                    <option value="square">Square</option>
                  </select>
                </div>

                <div className={styles.popoverRow}>
                  <span className={styles.popoverLabel}>Join</span>
                  <select
                    value={stroke?.join ?? 'round'}
                    onChange={(e) => handleStrokeJoinChange(e.target.value as StrokeJoin)}
                    className={styles.select}
                    style={{ width: 100 }}
                  >
                    <option value="miter">Miter</option>
                    <option value="round">Round</option>
                    <option value="bevel">Bevel</option>
                  </select>
                </div>

                <div className={styles.popoverRow}>
                  <span className={styles.popoverLabel}>Dash</span>
                  <input
                    type="text"
                    value={(stroke?.dash ?? []).join(', ')}
                    placeholder="8, 4"
                    onChange={(e) => handleStrokeDashChange(e.currentTarget.value)}
                    className={styles.textInput}
                    style={{ width: 100, height: 24, padding: '2px 6px' }}
                  />
                </div>

                {/* Offset is only meaningful against a pattern, so it appears
                    with one. Shown unconditionally it would be a control that
                    provably does nothing — worse than a missing one, because it
                    reads as working. */}
                {(stroke?.dash ?? []).length > 0 && (
                  <AnimatablePaintRow nodeId={nodeId} prop="strokeDashOffset" label="Dash Offset" access={STROKE_ACCESS.dashOffset} />
                )}

                {/* ── Taper and Wave (AE's Stroke group) ──
                    One group, because AE ships them as one and they share the
                    same arc-length walk. Every row is keyframeable and every
                    track is folded in `buildSnapshot` — a stopwatch the renderer
                    ignores is F34/F35, and the class guard now fails the build
                    for it.

                    The dashed-stroke warning that used to sit here is gone
                    because the limitation is gone: dash and taper compose now,
                    each dash reading its width from where it sits on the whole
                    path. A warning about a restriction that no longer exists is
                    worse than none. */}

                <AnimatablePaintRow nodeId={nodeId} prop="strokeTaperStartWidth" label="Taper Start" access={STROKE_ACCESS.taperStartWidth} />
                <AnimatablePaintRow nodeId={nodeId} prop="strokeTaperEndWidth" label="Taper End" access={STROKE_ACCESS.taperEndWidth} />
                {hasTaper && (
                  <>
                    <AnimatablePaintRow nodeId={nodeId} prop="strokeTaperStartLength" label="Start Length" access={STROKE_ACCESS.taperStartLength} />
                    <AnimatablePaintRow nodeId={nodeId} prop="strokeTaperEndLength" label="End Length" access={STROKE_ACCESS.taperEndLength} />
                    <AnimatablePaintRow nodeId={nodeId} prop="strokeTaperStartEase" label="Start Ease" access={STROKE_ACCESS.taperStartEase} />
                    <AnimatablePaintRow nodeId={nodeId} prop="strokeTaperEndEase" label="End Ease" access={STROKE_ACCESS.taperEndEase} />
                  </>
                )}

                <AnimatablePaintRow nodeId={nodeId} prop="strokeWaveAmount" label="Wave Amount" access={STROKE_ACCESS.waveAmount} />
                {/* Wavelength and phase only mean something against an
                    amplitude — the same rule the Dash Offset row above follows. */}
                {hasWave && (
                  <>
                    <AnimatablePaintRow nodeId={nodeId} prop="strokeWaveWavelength" label="Wavelength" access={STROKE_ACCESS.waveWavelength} />
                    <AnimatablePaintRow nodeId={nodeId} prop="strokeWavePhase" label="Wave Phase" access={STROKE_ACCESS.wavePhase} />
                  </>
                )}

                {/* Gradient stroke: an optional paint that overrides the solid
                    colour (Canvas2D builds the gradient in layer space). */}
                <div className={styles.popoverRow}>
                  <span className={styles.popoverLabel}>Paint</span>
                  <select
                    className={styles.select}
                    style={{ width: 100 }}
                    value={stroke?.paint && stroke.paint.type !== 'solid' ? stroke.paint.type : 'solid'}
                    onChange={(e) => {
                      const t = e.target.value as FillType;
                      if (t === 'solid') {
                        updateNodeStroke(nodeId, { paint: undefined });
                      } else {
                        updateNodeStroke(nodeId, { paint: convertFill(stroke?.paint, t) });
                      }
                    }}
                    aria-label="Stroke paint type"
                  >
                    <option value="solid">Solid color</option>
                    <option value="linear">Linear gradient</option>
                    <option value="radial">Radial gradient</option>
                  </select>
                </div>
                {/* The full stop list, not two lone end-pickers. A gradient
                    stroke has always RENDERED any number of stops; until now
                    only its two ends were editable and none could be added. */}
                {stroke?.paint && stroke.paint.type !== 'solid' && (
                  <StopList nodeId={nodeId} paint={stroke.paint} target="stroke" />
                )}
              </div>
            )}

        {/* Extra strokes (multi-stroke stack). */}
        {strokes.slice(1).map((s, i) => (
          <div key={`xstroke_${i}`} className={styles.popoverRow}>
            <span className={styles.popoverLabel}>Stroke {i + 2}</span>
            <ValueField
              value={s.width}
              unit="px"
              min={0}
              onChange={(v) => {
                const next = [...strokes];
                next[i + 1] = normalizeStroke({ ...s, width: Number(v) });
                setNodeStrokes(nodeId, next);
              }}
              aria-label={`Stroke ${i + 2} width`}
            />
            <ColorPicker
              compact
              value={s.color}
              onChange={(hex) => {
                const next = [...strokes];
                next[i + 1] = normalizeStroke({ ...s, color: hex });
                setNodeStrokes(nodeId, next);
              }}
              aria-label={`Stroke ${i + 2} color`}
            />
            <button
              type="button"
              className={effStyles.remove}
              aria-label={`Remove stroke ${i + 2}`}
              onClick={() => setNodeStrokes(nodeId, strokes.filter((_, si) => si !== i + 1))}
            >
              <Icon name="close" size="sm" />
            </button>
          </div>
        ))}
        {(stroke?.enabled ?? false) && (
          <button
            type="button"
            className={effStyles.addChip}
            style={{ gap: 5 }}
            onClick={() => setNodeStrokes(nodeId, [...(strokes.length ? strokes : [defaultStroke()]), normalizeStroke({ ...defaultStroke('#ffffff'), width: 2 })])}
          >
            <Icon name="plus" size="sm" /> Add stroke
          </button>
        )}
    </>
  );
}

export default StrokeRows;
