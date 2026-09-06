import { Switch } from '@components/Switch';
import { ValueField } from '@components/ValueField';
import { useSceneRevision } from '@stores/sceneStore';
import { useMotionBlurStore } from '@stores/motionBlurStore';

import { getNodeAdjustment, setNodeAdjustment } from '@core/effects/adjustment';
import { getNodeMotionBlur, setNodeMotionBlur } from '@core/effects/motionBlur';
import { getNodeQuality, setNodeQuality } from '@core/effects/layerQuality';
import {
  enableLayerMotionBlurWithFeedback,
  disableLayerMotionBlur,
  setAdjustmentWithFeedback,
} from '@core/effects/layerSwitchFeedback';
import { aggregateFlag, applyFlagAll } from '@core/inspector/multiSelection';
import { useInspectorSelection } from './inspectorSelection';
import styles from '../Effects/EffectsPanel.module.css';

/**
 * The three per-layer switches, written across the SELECTION.
 *
 * They are booleans on the node rather than animation tracks, so they cannot
 * go through `MultiPropertyRow`; `aggregateFlag` / `applyFlagAll` give them
 * the two things that row provides and a bare `Switch` does not — a visible
 * "these layers disagree" state, and one undo entry per gesture no matter how
 * many layers it touched.
 *
 * When the selection disagrees the switch shows unchecked-but-mixed and the
 * first click turns the flag ON for everything, which is the answer people
 * expect from a mixed toggle: you clicked it to make them all match, and "all
 * on" is the state you were reaching for.
 */
export function LayerSwitchesControls({ nodeId }: { nodeId: string }): JSX.Element {
  useSceneRevision((s) => s.rev);
  const mb = useMotionBlurStore();
  const nodeIds = useInspectorSelection(nodeId);

  const adjustment = aggregateFlag(nodeIds, getNodeAdjustment);
  const blur = aggregateFlag(nodeIds, getNodeMotionBlur);
  const draft = aggregateFlag(nodeIds, (id) => getNodeQuality(id) === 'draft');
  const motionBlur = blur.value;

  /** A mixed switch reads as off, and its next click turns everything on. */
  const nextOf = (agg: { value: boolean; mixed: boolean }): boolean => (agg.mixed ? true : !agg.value);
  const suffix = nodeIds.length > 1 ? ` (${nodeIds.length} layers)` : '';
  const mixedTitle = (label: string, agg: { mixed: boolean }): string | undefined =>
    (agg.mixed ? `Mixed — the selected layers disagree on ${label}` : undefined);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div className={styles.blendRow}>
        <span className={styles.blendLabel} title={mixedTitle('Adjustment Layer', adjustment)}>
          {`Adjustment Layer${adjustment.mixed ? ' — mixed' : ''}`}
        </span>
        <Switch
          checked={!adjustment.mixed && adjustment.value}
          data-mixed={adjustment.mixed || undefined}
          onChange={() => {
            const next = nextOf(adjustment);
            applyFlagAll(nodeIds, 'Adjustment Layer', (id) => setAdjustmentWithFeedback(id, next, setNodeAdjustment));
          }}
          aria-label={`Adjustment layer${suffix}`}
        />
      </div>

      <div className={styles.blendRow}>
        <span className={styles.blendLabel} title={mixedTitle('Motion Blur', blur)}>
          {`Motion Blur${blur.mixed ? ' — mixed' : ''}`}
        </span>
        <Switch
          checked={!blur.mixed && blur.value}
          data-mixed={blur.mixed || undefined}
          onChange={() => {
            const next = nextOf(blur);
            applyFlagAll(nodeIds, 'Motion Blur', (id) => {
              if (next) enableLayerMotionBlurWithFeedback(id, setNodeMotionBlur);
              else disableLayerMotionBlur(id, setNodeMotionBlur);
            });
          }}
          aria-label={`Motion blur${suffix}`}
        />
      </div>

      {motionBlur && (
        <div className={styles.maskControls} style={{ padding: '8px', background: 'var(--color-surface-1)', borderRadius: 4, display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'stretch' }}>
          <label className={styles.blendLabel} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Switch checked={mb.enabled} onChange={(e) => mb.setEnabled(e.currentTarget.checked)} aria-label="Comp motion blur enabled" />
            Comp enabled
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <label className={styles.maskField}>
              <span>Shutter°</span>
              <ValueField value={mb.shutterAngle} min={0} max={360} precision={0} unit="°"
                onChange={mb.setShutterAngle} aria-label="Shutter angle" />
            </label>
            <label className={styles.maskField}>
              <span>Phase°</span>
              <ValueField value={mb.shutterPhase ?? -90} min={-360} max={360} precision={0} unit="°"
                onChange={mb.setShutterPhase} aria-label="Shutter phase" />
            </label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <label className={styles.maskField}>
              <span>Samples</span>
              <ValueField value={mb.samples} min={2} max={32} precision={0}
                onChange={mb.setSamples} aria-label="Motion blur samples" />
            </label>
            <label className={styles.maskField}>
              <span>Limit</span>
              <ValueField value={mb.adaptiveSampleLimit ?? 128} min={2} max={128} precision={0}
                onChange={mb.setAdaptiveSampleLimit} aria-label="Adaptive sample limit" />
            </label>
          </div>
        </div>
      )}

      <div className={styles.blendRow}>
        <span
          className={styles.blendLabel}
          title={mixedTitle('Draft Quality', draft) ?? 'Draft: nearest-neighbour sampling for this layer (faster, rougher)'}
        >
          {`Draft Quality${draft.mixed ? ' — mixed' : ''}`}
        </span>
        <Switch
          checked={!draft.mixed && draft.value}
          data-mixed={draft.mixed || undefined}
          onChange={() => {
            const next = nextOf(draft);
            applyFlagAll(nodeIds, 'Draft Quality', (id) => setNodeQuality(id, next ? 'draft' : 'best'));
          }}
          aria-label={`Draft quality${suffix}`}
        />
      </div>

      {/* "Casts Shadows" is NOT here. It is an AE Material Option and lives with
          the rest of them in ThreeDControl — having a second switch for the same
          value in a different tab meant two controls could visibly disagree
          until one was re-rendered. One property, one owner. */}
    </div>
  );
}
