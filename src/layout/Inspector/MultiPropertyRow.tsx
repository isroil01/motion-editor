/**
 * MultiPropertyRow — ONE animatable numeric property of the SELECTION.
 *
 * This is the row every inspector section reaches for once it has more than
 * a single layer to describe. It composes the pieces that used to be re-wired
 * at each call site — the stopwatch, the keyframe navigator, the reset, the
 * right-click menu — and adds the ones no call site had:
 *
 *   • mixed values across a multi-selection (`—`), with relative drag and
 *     per-layer `+10` / `*2`, every gesture one undo entry (`multiSelection`);
 *   • an `=` toggle that opens the inline expression editor, an error
 *     underline with the message on hover, and a pick-whip on the row;
 *   • the property's modifier chips, when it has a stack;
 *   • the mini keyframe lane, when the panel preference is on;
 *   • the pin mark, when the property is on the Pinned tab.
 *
 * Reads are per node revision (`useNodesRevision`) and the playhead is a
 * scalar subscription, so a scrub on another layer leaves this row alone.
 *
 * Values are shown in DISPLAY units (`meta.displayScale`, e.g. 0..1 stored as
 * 0..100 %) and written back in engine units; the conversion lives here so
 * the model beneath never learns about percent signs.
 */

import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ValueField } from '@components/ValueField';
import { PropertyRow, KeyframeLane } from '@components/PropertyRow';
import { PickWhip } from '@components/PickWhip';
import { cn } from '@utils/cn';
import { applyValueExpression } from '@utils/evalMath';
import { defaultAnimation, makeKeyframeId } from '@motion/animation';
import { runAnimEdit } from '@core/animation/animationCommands';
import { applyEasingToKeyframes, type EasingPreset } from '@core/animation/keyframeAssistants';
import { compToKeyframeTime, keyframeToCompTime } from '@core/timeline/TimelineController';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { whipExpression } from '@core/whip/whipTarget';
import { resolvePropertyMeta } from '@core/inspector/propertyMeta';
import { buildPropertyMenu } from '@core/inspector/propertyMenu';
import { isPinnedProp } from '@core/inspector/pinnedProps';
import { useNodesRevision } from '@core/inspector/nodeRevision';
import { readModifierStack } from '@core/animation/modifierStack';
import {
  aggregateProperty,
  applyAbsolute,
  applyRelative,
  applyValues,
  navigatorState,
  readPropertyValue,
  snapshotStarts,
  toggleAnimationAll,
  toggleKeyframeAll,
  type PropertyAccess,
} from '@core/inspector/multiSelection';
import { openContextMenu, type ContextMenuItem } from '@stores/contextMenuStore';
import { useCurrentTime } from '@stores/playbackClockStore';
import { useProjectStore } from '@stores/projectStore';
import { useCompositionStore } from '@stores/compositionStore';
import { usePreferenceStore } from '@stores/preferenceStore';
import { ExpressionEditor } from '@layout/Motion/ExpressionEditor';
import { useInspectorSelection } from './inspectorSelection';
import { ModifierChips } from './ModifierChips';
import styles from './MultiPropertyRow.module.css';

export interface MultiPropertyRowProps {
  /** The PRIMARY layer; the selection comes from context. */
  nodeId: string;
  /** Animation prop path (`x`, `strokeWidth`, `effect.fx_1.radius`, …). */
  prop: string;
  /** Display label override (the registry label otherwise). */
  label?: string;
  /** Custom read / static-write for values the property seam cannot see. */
  access?: PropertyAccess;
  /** Extra control inside the value cell, before the field (a rotation dial). */
  before?: ReactNode;
  /**
   * Like `before`, but handed the row's aggregated value and its writer, so a
   * dial can show the number and write through the same multi-selection path.
   */
  renderBefore?: (ctx: { value: number; mixed: boolean; setValue: (display: number) => void }) => ReactNode;
  /** Extra controls after the `=` and the whip — an Unpin button. */
  extraTrailing?: ReactNode;
  /** A second property written with the same value — Linked Scale. */
  linkedProp?: string;
  /** Hide the reset even when the registry allows one. */
  noReset?: boolean;
  /** Draws the row's short name; the full registry name still reaches AT. */
  shortLabel?: boolean;
  /** A hint the caller wants shown ("Essential"). */
  hint?: string;
  compact?: boolean;
  className?: string;
}

const EASINGS: ReadonlyArray<{ id: EasingPreset; label: string }> = [
  { id: 'Linear', label: 'Linear' },
  { id: 'Ease', label: 'Easy Ease' },
  { id: 'EaseIn', label: 'Easy Ease In' },
  { id: 'EaseOut', label: 'Easy Ease Out' },
  { id: 'Hold', label: 'Toggle Hold' },
];

function MultiPropertyRowInner({
  nodeId,
  prop,
  label: labelOverride,
  access,
  before,
  renderBefore,
  extraTrailing,
  linkedProp,
  noReset = false,
  shortLabel = false,
  hint: hintOverride,
  compact = true,
  className,
}: MultiPropertyRowProps): JSX.Element | null {
  const nodeIds = useInspectorSelection(nodeId);
  // The tick is a dependency below: the scene graph can hand back the same
  // node object after a write, so identity alone cannot invalidate the read.
  const rev = useNodesRevision(nodeIds);
  const time = useCurrentTime();
  const fps = useCompositionStore((c) => c.fps) || 30;
  const duration = useCompositionStore((c) => c.durationSeconds) || 0;
  const autoKeyframe = usePreferenceStore((s) => s.timelineAutoKeyframe);
  const showLane = usePreferenceStore((s) => s.inspectorShowLane);
  const [exprOpen, setExprOpen] = useState(false);
  const starts = useRef<Map<string, number>>(new Map());

  const node = defaultSceneGraph.getNode(nodeId);
  const meta = resolvePropertyMeta(prop, nodeId);
  const scale = meta.displayScale ?? 1;
  const agg = useMemo(
    () => aggregateProperty(nodeIds, prop, time, access),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- revision-driven
    [nodeIds, prop, time, access, node, rev],
  );

  const opts = useMemo(
    () => ({ compTime: time, autoKeyframe, ...access }),
    [time, autoKeyframe, access],
  );
  const mergeKey = `multi:${prop}:${nodeIds.join(',')}:${time}`;

  const writeAll = useCallback((display: number) => {
    const engine = display / scale;
    applyAbsolute(nodeIds, prop, engine, { ...opts, mergeKey, label: `Set ${meta.label}` });
    if (linkedProp) applyAbsolute(nodeIds, linkedProp, engine, { ...opts, mergeKey, label: `Set ${meta.label}` });
  }, [nodeIds, prop, linkedProp, opts, mergeKey, meta.label, scale]);

  const onScrubStart = useCallback(() => {
    starts.current = snapshotStarts(nodeIds, prop, time, access);
  }, [nodeIds, prop, time, access]);

  const onRelative = useCallback((delta: number, cumulative: boolean) => {
    const from = cumulative ? starts.current : snapshotStarts(nodeIds, prop, time, access);
    const bounds = { min: meta.min, max: meta.max };
    applyRelative(prop, from, delta / scale, { ...opts, ...bounds, mergeKey, label: `Offset ${meta.label}` });
    if (linkedProp) {
      const linkedFrom = cumulative
        ? starts.current
        : snapshotStarts(nodeIds, linkedProp, time, access);
      applyRelative(linkedProp, linkedFrom, delta / scale, { ...opts, ...bounds, mergeKey, label: `Offset ${meta.label}` });
    }
  }, [nodeIds, prop, linkedProp, time, access, opts, mergeKey, meta, scale]);

  const onCommitText = useCallback((raw: string): boolean => {
    const writes: Array<{ nodeId: string; value: number }> = [];
    for (const id of nodeIds) {
      const cur = readPropertyValue(id, prop, time, access);
      if (cur === undefined) continue;
      const next = applyValueExpression(cur * scale, raw);
      if (next === null) return false;
      const clamped = Math.min(meta.max ?? Infinity, Math.max(meta.min ?? -Infinity, next));
      writes.push({ nodeId: id, value: clamped / scale });
    }
    if (writes.length === 0) return false;
    applyValues(prop, writes, { ...opts, label: `Set ${meta.label}` });
    if (linkedProp) applyValues(linkedProp, writes, { ...opts, label: `Set ${meta.label}` });
    return true;
  }, [nodeIds, prop, linkedProp, time, access, opts, meta, scale]);

  if (!node) return null;

  const label = labelOverride ?? meta.label;
  const displayLabel = shortLabel ? (label.replace(/(Position|Scale|Rotation|Anchor Point)\s*/i, '') || label) : label;
  const nav = navigatorState(nodeIds, prop, time);
  const seek = (t: number): void => {
    useProjectStore.getState().actions.setTime(t, Math.round(t * fps));
  };
  const hasExpr = defaultAnimation.hasExpression(nodeId, prop);
  const exprEnabled = defaultAnimation.isExpressionEnabled(nodeId, prop);
  const exprError = exprEnabled ? defaultAnimation.getExpressionError(nodeId, prop) : null;
  const hasStack = readModifierStack(node, prop) !== null;
  const pinned = isPinnedProp(nodeId, prop);
  const resetVal = !noReset && meta.resettable && typeof meta.defaultValue === 'number' ? meta.defaultValue : undefined;
  const layerT = compToKeyframeTime(nodeId, time, prop);

  const hint = hintOverride ?? (nodeIds.length > 1 && agg.present < nodeIds.length
    ? `${agg.present} of ${nodeIds.length}`
    : undefined);

  // The lane draws the PRIMARY layer's keyframes on the comp axis.
  const laneTimes = showLane && agg.animated
    ? (defaultAnimation.getTrackKeyframes(nodeId, prop) ?? []).map((k) => keyframeToCompTime(nodeId, k.t, prop))
    : null;

  const onLaneRetime = (fromC: number, toC: number): void => {
    const fromT = compToKeyframeTime(nodeId, fromC, prop);
    const toT = compToKeyframeTime(nodeId, toC, prop);
    runAnimEdit(`Move ${label} keyframe`, () => defaultAnimation.moveKeyframe(nodeId, prop, fromT, toT));
  };

  const onLaneContext = (e: React.MouseEvent, compT: number): void => {
    const t = compToKeyframeTime(nodeId, compT, prop);
    const id = makeKeyframeId(nodeId, prop, t);
    const items: ContextMenuItem[] = [
      {
        id: 'lane-easing',
        label: 'Keyframe Interpolation',
        children: EASINGS.map((p) => ({ id: `lane-ease-${p.id}`, label: p.label, onSelect: () => applyEasingToKeyframes([id], p.id) })),
      },
      { id: 'lane-sep', separator: true },
      {
        id: 'lane-remove',
        label: 'Remove Keyframe',
        danger: true,
        onSelect: () => runAnimEdit(`Remove ${label} keyframe`, () => defaultAnimation.removeKeyframe(nodeId, prop, t)),
      },
    ];
    openContextMenu(e.clientX, e.clientY, items);
  };

  const onWhip = (target: { nodeId: string; prop?: string }): void => {
    const name = defaultSceneGraph.getNode(target.nodeId)?.name;
    if (!name) return;
    const src = whipExpression(name, target.prop ?? prop);
    runAnimEdit(`Link ${label}`, () => defaultAnimation.batch(() => {
      for (const id of nodeIds) {
        defaultAnimation.setExpression(id, prop, src);
        defaultAnimation.setExpressionEnabled(id, prop, true);
      }
    }));
    setExprOpen(true);
  };

  const trailing = (
    <>
      <button
        type="button"
        className={cn(styles.exprToggle, hasExpr && styles.exprOn, exprError && styles.exprErr)}
        aria-pressed={exprOpen}
        aria-label={`${exprOpen ? 'Hide' : 'Show'} ${label} expression`}
        title={exprError ?? (hasExpr ? (exprEnabled ? 'Expression on — click to edit' : 'Expression off — click to edit') : 'Add an expression')}
        onClick={(e) => { e.stopPropagation(); setExprOpen((v) => !v); }}
      >
        =
      </button>
      <PickWhip
        label={`${label} pick-whip — drag onto a layer or property to link`}
        className={styles.whip}
        accept={(target) => !(target.nodeId === nodeId && (target.prop ?? prop) === prop)}
        onPick={onWhip}
      />
      {extraTrailing}
    </>
  );

  const below = (exprOpen || hasStack || laneTimes) ? (
    <div className={styles.below}>
      {hasStack && <ModifierChips nodeId={nodeId} prop={prop} />}
      {exprOpen && (
        <div className={styles.expr}>
          <ExpressionEditor nodeId={nodeId} prop={prop} />
        </div>
      )}
      {laneTimes && (
        <KeyframeLane
          times={laneTimes}
          duration={duration}
          fps={fps}
          label={label}
          onSeek={seek}
          onRetime={onLaneRetime}
          onKeyframeContextMenu={onLaneContext}
        />
      )}
    </div>
  ) : undefined;

  return (
    <PropertyRow
      label={displayLabel}
      srLabel={label}
      animated={agg.animated}
      mixed={agg.mixed}
      hint={hint}
      pinned={pinned}
      error={exprError}
      compact={compact}
      className={cn(styles.row, exprOpen && styles.rowExprOpen, className)}
      onStopwatch={() => toggleAnimationAll(nodeIds, prop, time, access)}
      navigator={{
        hasPrev: nav.hasPrev,
        hasNext: nav.hasNext,
        atKeyframe: nav.atKeyframe,
        onPrev: () => nav.prevT !== null && seek(nav.prevT),
        onNext: () => nav.nextT !== null && seek(nav.nextT),
        onToggleKeyframe: () => toggleKeyframeAll(nodeIds, prop, time, access),
      }}
      onReset={resetVal !== undefined ? () => writeAll(resetVal * scale) : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        openContextMenu(
          e.clientX,
          e.clientY,
          buildPropertyMenu({
            nodeId,
            prop,
            layerT,
            value: agg.value,
            setValue: (v) => writeAll(v * scale),
          }),
        );
      }}
      trailing={trailing}
      below={below}
    >
      {before}
      {renderBefore?.({ value: agg.value * scale, mixed: agg.mixed, setValue: writeAll })}
      <ValueField
        value={agg.value * scale}
        mixed={agg.mixed}
        unit={meta.unit}
        min={meta.min !== undefined ? meta.min * scale : undefined}
        max={meta.max !== undefined ? meta.max * scale : undefined}
        step={meta.step * scale}
        precision={meta.precision}
        onChange={writeAll}
        onScrubStart={onScrubStart}
        onRelative={onRelative}
        onCommitText={onCommitText}
        aria-label={label}
      />
    </PropertyRow>
  );
}

export const MultiPropertyRow = memo(MultiPropertyRowInner);
export default MultiPropertyRow;
