/**
 * TransformSection — anchor, position, scale, size, rotation, opacity and the
 * advanced 3D tail, as an AE-style flat property list.
 *
 * Every numeric row is a `MultiPropertyRow` (2026-09-04): the row reads the
 * property across the WHOLE selection, shows `—` where the layers disagree,
 * writes every layer on a typed value, offsets every layer on a drag, and
 * records one undo entry per gesture. The section itself keeps only what is
 * not a row — the group subheads with their group stopwatches, the anchor
 * snap matrix, the Linked Scale switch, the advanced disclosure and the
 * preset menu.
 *
 * Reads are per NODE revision, so a scrub on an unselected layer does not
 * touch this section, and the section is memoised by its host so a keystroke
 * in the panel's search box does not re-run it.
 */

import { memo, useCallback, useMemo, useState, type ReactNode } from 'react';
import { Icon } from '@components/Icon';
import { AngleDial } from '@components/AngleDial';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { is3DEnabled, canBe3D } from '@core/scene/threeD';
import { setAnchor, estimateNodeBounds } from '@core/scene/anchor';
import { readNodeKind } from '@core/scene/sceneDerive';
import { defaultAnimation } from '@motion/animation';
import { useNodeRevision } from '@core/inspector/nodeRevision';
import { staticOrDefaultValue } from '@core/inspector/propertyValue';
import { toggleAnimationGroup, type PropertyAccess } from '@core/inspector/multiSelection';
import { applyTransformPreset, captureTransformPreset } from '@core/inspector/sectionPresets';
import { useCurrentTime } from '@stores/playbackClockStore';
import { usePreferenceStore } from '@stores/preferenceStore';
import { batchHistory } from '@stores/historyStore';
import { MultiPropertyRow } from './MultiPropertyRow';
import { SectionPresetMenu } from './SectionPresetMenu';
import { ThreeDControl } from './ThreeDControl';
import { useInspectorSelection } from './inspectorSelection';

import styles from './TransformSection.module.css';

/** Rotation-flavored props get a purpose-built dial next to their number —
 *  the dial writes through the SAME path as the ValueField, so keyframing,
 *  auto-key and multi-selection behaviour are identical. */
const ROTATION_PROPS = new Set([
  'rotation',
  'rotationX',
  'rotationY',
  'orientationX',
  'orientationY',
  'orientationZ',
]);

const ANCHOR_PRESETS: Array<{ id: string; label: string; getOffset: (w: number, h: number) => { x: number; y: number } }> = [
  { id: 'tl', label: 'Top Left', getOffset: (w: number, h: number) => ({ x: -w / 2, y: -h / 2 }) },
  { id: 'tc', label: 'Top Center', getOffset: (_w: number, h: number) => ({ x: 0, y: -h / 2 }) },
  { id: 'tr', label: 'Top Right', getOffset: (w: number, h: number) => ({ x: w / 2, y: -h / 2 }) },
  { id: 'ml', label: 'Middle Left', getOffset: (w: number, _h: number) => ({ x: -w / 2, y: 0 }) },
  { id: 'mc', label: 'Center', getOffset: (_w: number, _h: number) => ({ x: 0, y: 0 }) },
  { id: 'mr', label: 'Middle Right', getOffset: (w: number, _h: number) => ({ x: w / 2, y: 0 }) },
  { id: 'bl', label: 'Bottom Left', getOffset: (w: number, h: number) => ({ x: -w / 2, y: h / 2 }) },
  { id: 'bc', label: 'Bottom Center', getOffset: (_w: number, h: number) => ({ x: 0, y: h / 2 }) },
  { id: 'br', label: 'Bottom Right', getOffset: (w: number, h: number) => ({ x: w / 2, y: h / 2 }) },
];

/** Props that live on the Style/Text component rather than the Transform. */
const STYLE_PROPS = new Set(['opacity', 'fillOpacity']);

function hasTransform(nodeId: string): boolean {
  return defaultSceneGraph.getNode(nodeId)?.components.some((c) => c.type === 'Transform') === true;
}

function hasStyle(nodeId: string): boolean {
  return defaultSceneGraph.getNode(nodeId)?.components.some((c) => c.type === 'Style' || c.type === 'Text') === true;
}

/**
 * Per-prop readers, cached by prop so their identity is stable across renders
 * (a `MultiPropertyRow` memoises on `access`).
 *
 * A layer whose Transform never stored `scaleX` still HAS a scale of 1 — the
 * registry default — so the reader answers the default rather than "absent",
 * exactly as the old `typeof raw === 'number' ? raw : 1` fallbacks did. A
 * layer with no Transform component at all (audio) is absent.
 */
const ACCESS = new Map<string, PropertyAccess>();
function accessFor(prop: string): PropertyAccess {
  let a = ACCESS.get(prop);
  if (a) return a;
  const present = STYLE_PROPS.has(prop) ? hasStyle : hasTransform;
  a = { read: (id) => (present(id) ? staticOrDefaultValue(id, prop) : undefined) };
  if (prop === 'anchorX' || prop === 'anchorY') {
    // Anchor writes go through `setAnchor` so the position is compensated
    // and the layer does not jump — the same path the canvas gizmo uses.
    a = {
      ...a,
      writeStatic: (id, v) => {
        if (!hasTransform(id)) return false;
        const ax = prop === 'anchorX' ? v : staticOrDefaultValue(id, 'anchorX');
        const ay = prop === 'anchorY' ? v : staticOrDefaultValue(id, 'anchorY');
        setAnchor(id, ax, ay);
        return true;
      },
    };
  }
  ACCESS.set(prop, a);
  return a;
}

export function TransformPresetAction({
  nodeId,
  nodeIds,
}: {
  nodeId: string;
  nodeIds?: ReadonlyArray<string>;
}): JSX.Element {
  const time = useCurrentTime();
  const autoKeyframe = usePreferenceStore((s) => s.timelineAutoKeyframe);
  const targetIds = useInspectorSelection(nodeId);
  const effectiveNodeIds = nodeIds && nodeIds.length > 0 ? nodeIds : targetIds;

  const capturePreset = useCallback(() => captureTransformPreset(nodeId, time), [nodeId, time]);
  const applyPreset = useCallback(
    (values: Readonly<Record<string, number | string | boolean>>) =>
      applyTransformPreset(effectiveNodeIds, values, { compTime: time, autoKeyframe }),
    [effectiveNodeIds, time, autoKeyframe],
  );

  return (
    <SectionPresetMenu
      sectionId="transform"
      label="Transform presets"
      capture={capturePreset}
      apply={applyPreset}
    />
  );
}

function TransformSectionInner({ nodeId }: { nodeId: string }): JSX.Element | null {
  useNodeRevision(nodeId);
  const nodeIds = useInspectorSelection(nodeId);
  const time = useCurrentTime();
  const node = defaultSceneGraph.getNode(nodeId);
  const [linkedScale, setLinkedScale] = useState(true);

  // NO early return before the hooks below — the hook count must not depend
  // on whether the node exists (deleting a selected layer with this panel open
  // used to throw "Rendered fewer hooks than expected").
  const tComp = useMemo(() => node?.components.find((c) => c.type === 'Transform'), [node]);
  const sComp = useMemo(() => node?.components.find((c) => c.type === 'Style' || c.type === 'Text'), [node]);

  const rotationDial = useCallback(
    (label: string) => ({ value, setValue }: { value: number; setValue: (v: number) => void }): ReactNode => (
      <AngleDial value={value} onChange={setValue} aria-label={`${label} dial`} />
    ),
    [],
  );

  // Single render guard, AFTER every hook.
  if (!node || !tComp) return null;

  const read = (prop: string): number => staticOrDefaultValue(nodeId, prop);
  const widthVal = tComp.props.width;
  const heightVal = tComp.props.height;
  const hasSize = typeof widthVal === 'number' && typeof heightVal === 'number';

  const row = (prop: string, extra?: { linkedProp?: string }): JSX.Element => (
    <MultiPropertyRow
      key={prop}
      nodeId={nodeId}
      prop={prop}
      shortLabel
      access={accessFor(prop)}
      linkedProp={extra?.linkedProp}
      renderBefore={ROTATION_PROPS.has(prop) ? rotationDial(prop) : undefined}
    />
  );

  /** The GROUP stopwatch on a subhead: every prop of the group, every layer. */
  const groupStopwatch = (label: string, props: string[]): JSX.Element => {
    const animated = nodeIds.some((id) => props.some((p) => defaultAnimation.isAnimated(id, p)));
    return (
      <button
        type="button"
        className={`${styles.stopwatch} ${animated ? styles.stopwatchOn : ''}`}
        title={animated ? 'Remove animation (delete keyframes)' : 'Enable animation (create first keyframe)'}
        onClick={(e) => {
          e.stopPropagation();
          toggleAnimationGroup(nodeIds, props, time, label, accessFor(props[0] ?? ''));
        }}
        aria-label={animated ? `Disable ${label} animation` : `Enable ${label} animation`}
      >
        <Icon name="stopwatch" size="sm" />
      </button>
    );
  };

  const kind = readNodeKind(node);
  const is3D = is3DEnabled(node);
  const isCamera = kind === 'camera';
  const isLight = kind === 'light';
  const hasDepth = isCamera || isLight || is3D;

  const anyAnimated = (props: string[]): boolean => props.some((p) => defaultAnimation.isAnimated(nodeId, p));

  // Interactive 3x3 anchor snapping, applied to every selected layer against
  // its OWN bounds — one undo entry for the lot.
  const bounds = hasSize ? { width: widthVal, height: heightVal } : estimateNodeBounds(nodeId);
  const anchorX = read('anchorX');
  const anchorY = read('anchorY');

  const applyAnchorPreset = (preset: typeof ANCHOR_PRESETS[number]): void => {
    batchHistory(`anchorPreset:${preset.id}:${nodeIds.join(',')}`, () => {
      for (const id of nodeIds) {
        const n = defaultSceneGraph.getNode(id);
        const t = n?.components.find((c) => c.type === 'Transform');
        if (!n || !t) continue;
        const w = t.props.width;
        const h = t.props.height;
        const b = typeof w === 'number' && typeof h === 'number' ? { width: w, height: h } : estimateNodeBounds(id);
        const target = preset.getOffset(b.width, b.height);
        setAnchor(id, target.x, target.y);
      }
    });
  };

  const isPresetActive = (preset: typeof ANCHOR_PRESETS[number]): boolean => {
    const target = preset.getOffset(bounds.width, bounds.height);
    return Math.abs(anchorX - target.x) < 1.5 && Math.abs(anchorY - target.y) < 1.5;
  };

  const positionProps = ['x', 'y', ...(hasDepth ? ['z'] : [])];
  const rotationProps = ['rotation', ...(is3D ? ['rotationX', 'rotationY'] : [])];

  // AE-style flat property list: a subhead per group (label · animated dot ·
  // stopwatch), then its rows inline — no popovers, everything one glance away.
  const subhead = (label: string, animated: boolean, stopwatch: JSX.Element | null, extra?: JSX.Element): JSX.Element => (
    <div className={styles.subhead}>
      {label}
      {animated && <span className={styles.animatedDot} />}
      {extra}
      <span style={{ flex: 1 }} />
      {stopwatch}
    </div>
  );

  return (
    <div className={styles.section}>
      <div className={styles.inlineRows}>
        {!isCamera && (
          <>
            {subhead('Anchor', anyAnimated(['anchorX', 'anchorY']), groupStopwatch('Anchor', ['anchorX', 'anchorY']))}
            <div className={styles.anchorMatrixRow}>
              <div
                className={styles.anchorOriginBox}
                title="Quick Snap Anchor Origin (3x3 Matrix)"
                role="group"
                aria-label="Anchor Origin Matrix"
              >
                {ANCHOR_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`${styles.anchorDot} ${isPresetActive(p) ? styles.anchorDotActive : ''}`}
                    title={p.label}
                    aria-label={`Snap anchor to ${p.label}`}
                    aria-pressed={isPresetActive(p)}
                    onClick={() => applyAnchorPreset(p)}
                  />
                ))}
              </div>
            </div>
            {row('anchorX')}
            {row('anchorY')}
          </>
        )}

        {subhead('Position', anyAnimated(positionProps), groupStopwatch('Position', positionProps))}
        {row('x')}
        {row('y')}
        {hasDepth && row('z')}

        <div className={styles.subhead}>
          <span>Scale</span>
          <button
            type="button"
            onClick={() => setLinkedScale(!linkedScale)}
            className={`${styles.lockToggle} ${linkedScale ? styles.lockToggleActive : ''}`}
            title={linkedScale ? 'Unlink Scale dimensions' : 'Link Scale dimensions (Uniform Zoom)'}
            aria-label={linkedScale ? 'Unlink Scale dimensions' : 'Link Scale dimensions (Uniform Zoom)'}
            aria-pressed={linkedScale}
          >
            <Icon name={linkedScale ? 'lock' : 'unlock'} size="sm" />
          </button>
          {anyAnimated(['scaleX', 'scaleY']) && <span className={styles.animatedDot} />}
          <span style={{ flex: 1 }} />
          {groupStopwatch('Scale', ['scaleX', 'scaleY'])}
        </div>
        {row('scaleX', { linkedProp: linkedScale ? 'scaleY' : undefined })}
        {row('scaleY', { linkedProp: linkedScale ? 'scaleX' : undefined })}

        {hasSize && (
          <>
            {subhead('Size', anyAnimated(['width', 'height']), groupStopwatch('Size', ['width', 'height']))}
            {row('width')}
            {row('height')}
          </>
        )}

        {subhead('Rotation', anyAnimated(rotationProps), groupStopwatch('Rotation', rotationProps))}
        {row('rotation')}

        {subhead('Skew', anyAnimated(['skew', 'skewAxis']), groupStopwatch('Skew', ['skew']))}
        {row('skew')}
        {row('skewAxis')}

        {sComp && (
          <>
            {subhead('Opacity', anyAnimated(['opacity']), groupStopwatch('Opacity', ['opacity']))}
            {row('opacity')}
            {row('fillOpacity')}
          </>
        )}

        {kind !== 'group' && kind !== 'null' && canBe3D(node) && (
          <ThreeDControl nodeId={nodeId}>
            {is3D && (
              <>
                {row('rotationX')}
                {row('rotationY')}
                {row('orientationX')}
                {row('orientationY')}
                {row('orientationZ')}
                {row('anchorZ')}
              </>
            )}
          </ThreeDControl>
        )}
      </div>
    </div>
  );
}


/*
 * Memoized: the Properties panel re-renders for its own reasons (a selection
 * change, a sub-tab switch, the sticky header) and hands every section the
 * same `nodeId` it had before. Without this boundary the section would rebuild
 * its whole subtree on each of those, undoing the per-node subscriptions the
 * rows inside it use to stay asleep. Pinned by `inspectorRenderScope.test.tsx`.
 */
export const TransformSection = memo(TransformSectionInner);

export default TransformSection;
