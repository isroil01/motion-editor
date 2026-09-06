/**
 * Track Motion — AE's tracker family, on the exact decoder.
 *
 * The section is arranged around the one thing most people want: point at an
 * object, get keyframes. That is the card at the top, and it is the whole
 * interface until you need more. Everything the panel used to open with —
 * six modes, two window-size dropdowns, nine buttons — still exists, one
 * disclosure down, because the people who need it need all of it.
 *
 * The split is a claim about the work, not a decoration: choosing a feature,
 * sizing the windows and choosing a direction are decisions the FOOTAGE can
 * answer (core/tracking/autoTrack.ts measures them), while choosing between a
 * planar pin and a mesh warp is a decision only the shot's author can make.
 * The first kind belongs in a button; the second belongs in controls.
 *
 * Points are placed by dragging the handles TrackPointOverlay draws on the
 * canvas — this panel reports them, because a coordinate you can see on the
 * footage beats a number field you have to guess into.
 *
 * Modes (advanced):
 *   Follow     — one point; apply as position keyframes on any layer.
 *   Transform  — two points; adds rotation and scale.
 *   Stabilize  — one point; apply INVERSE motion to this layer.
 *   Smooth     — dense optical flow; Warp Stabilizer-class.
 *   Corner pin — four points; keyframe a Corner Pin effect (screen replacement).
 *   Track mask — this layer's mask vertices are the points.
 *
 * Tracking runs on the ORIGINAL media through ExactVideoSource, never the
 * proxy and never a seeked <video> — the samples are measured on the frames
 * the renderer will actually show (see trackVideoLayer.ts).
 */

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@components/Button';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { useSceneRevision } from '@stores/sceneStore';
import { useTrackerStore } from '@stores/trackerStore';
import { useActiveWorkspace } from '@stores/projectStore';
import { useCompositionStore } from '@stores/compositionStore';
import { getNodeMask } from '@core/effects/mask';
import { sourceDisplaySize } from '@core/tracking/trackerSource';
import { webCodecsAvailable } from '@core/video/exactVideoSource';
import { qualityOf } from './trackMotion/trackMotionCopy';
import { trackMotionActions, type StabVariant, type TrackMotionContext } from './trackMotion/trackMotionActions';
import { AdvancedTracking } from './trackMotion/AdvancedTracking';
import styles from './TrackMotionSection.module.css';

/*
 * Split (2026-09-04): this file is the SECTION — its hooks, the one-click
 * card, and the disclosure below it. The window presets and mode copy are
 * `trackMotion/trackMotionCopy.ts`, every button's work is
 * `trackMotion/trackMotionActions.ts`, and the advanced controls are
 * `trackMotion/AdvancedTracking.tsx`. Nothing moved changed.
 */

export function TrackMotionSection({ nodeId }: { nodeId: string }): JSX.Element | null {
  useSceneRevision((s) => s.rev);
  const mode = useTrackerStore((s) => s.mode);
  const points = useTrackerStore((s) => s.points);
  const featureHalf = useTrackerStore((s) => s.featureHalf);
  const searchHalf = useTrackerStore((s) => s.searchHalf);
  const dense = useTrackerStore((s) => s.dense);
  const tracking = useTrackerStore((s) => s.tracking);
  const progress = useTrackerStore((s) => s.progress);
  const result = useTrackerStore((s) => s.result);
  const note = useTrackerStore((s) => s.note);
  const autoPhase = useTrackerStore((s) => s.autoPhase);
  const autoPlan = useTrackerStore((s) => s.autoPlan);
  const store = useTrackerStore;
  const time = useActiveWorkspace()?.time ?? 0;
  const fps = useCompositionStore((c) => c.fps) || 30;
  const durationSeconds = useCompositionStore((c) => c.durationSeconds);
  const comp = useCompositionStore((c) => c.comp());
  const [targetId, setTargetId] = useState(nodeId);
  const [stabVariant, setStabVariant] = useState<StabVariant>('similarity');

  const node = defaultSceneGraph.getNode(nodeId);
  const src = sourceDisplaySize(nodeId);
  const maskPoints = node ? getNodeMask(nodeId).paths.reduce((n, p) => n + p.points.length, 0) : 0;

  // Opening the section for a layer arms the overlay for it and seeds the
  // mode's points so there are handles to grab at all. The section is mounted
  // only while OPEN (`mountOnOpen` on its accordion item), so closing it
  // disarms — the overlay leaves the canvas but keeps points and any result.
  useEffect(() => {
    store.getState().activate(nodeId);
    if (src) store.getState().seedPoints(src.width, src.height);
  }, [nodeId, src?.width, src?.height, mode]);
  useEffect(() => () => store.getState().disarm(), []);

  // Escape leaves the pick without tracking.
  //
  // stopIMMEDIATEPropagation, and in the capture phase: the app's own Escape
  // handler is also on `window`, and plain stopPropagation does not stop
  // listeners on the SAME node — so cancelling a pick ALSO cleared the
  // selection, which unmounted this very section. While the pick is armed,
  // Escape means one thing.
  useEffect(() => {
    if (autoPhase !== 'picking') return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      store.getState().setAutoPhase('idle');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [autoPhase, store]);

  const targets = useMemo(() => {
    if (!node) return [];
    // NOT getChildren(node.parent): on a fresh unsaved project layers hang
    // off the VIRTUAL 'comp_root' — a fallback id with no engine node — and
    // getChildren of a non-node is []. traverse sees every registered node,
    // so same-parent comparison works for real and virtual parents alike.
    const sameParent: typeof node[] = [];
    defaultSceneGraph.traverse((n) => {
      if ((n.parent ?? null) === (node.parent ?? null)) sameParent.push(n);
    });
    return sameParent.length > 0 ? sameParent : [node];
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scene rev drives this
  }, [node, useSceneRevision((s) => s.rev)]);

  if (!node || !src) return null;

  if (!webCodecsAvailable()) {
    return <p className={styles.cardHint}>Tracking needs WebCodecs, which this runtime does not have.</p>;
  }

  const endCompTime = Math.max(time, durationSeconds - 1 / fps);

  const ctx: TrackMotionContext = {
    nodeId, targetId, setTargetId, mode, points, featureHalf, searchHalf, tracking, result, autoPhase,
    time, endCompTime, fps, durationSeconds, comp, src, stabVariant, targets,
  };
  const actions = trackMotionActions(ctx);
  const { onArmPick, onTrackAgain, onCancel, onCreateNullAndApply, onApply } = actions;

  const canTrack = mode === 'mask' ? maskPoints > 0 : mode === 'smooth' ? true : points.length > 0;
  const applyLabel =
    mode === 'follow'
      ? 'Apply as position keyframes'
      : mode === 'transform'
        ? 'Apply position, rotation & scale'
        : mode === 'stabilize'
          ? 'Stabilize this layer'
          : 'Pin target to corners';
  const analyzing = autoPhase === 'analyzing';
  const picking = autoPhase === 'picking';
  const quality = autoPlan ? qualityOf(autoPlan) : null;
  const autoResult = autoPlan && result && (result.tracks[0]?.length ?? 0) > 1;

  return (
    <div className={styles.root}>
      <section className={styles.card} data-armed={picking}>
        <div className={styles.cardTitle}>
          <span>Track an object</span>
          {quality && (
            <span className={styles.quality} data-level={quality.level}>
              {quality.label}
            </span>
          )}
        </div>

        {analyzing ? (
          <>
            <div className={styles.progressRow}>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-label="Tracking progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress * 100)}
              >
                {/* scaleX, not width — see the module CSS: this repaints on
                    every tracked frame and must not relayout the panel. */}
                <div className={styles.progressFill} style={{ transform: `scaleX(${progress})` }} />
              </div>
              <span className={styles.progressValue}>{Math.round(progress * 100)}%</span>
            </div>
            <Button size="sm" variant="secondary" onClick={onCancel} fullWidth>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <p className={styles.cardHint}>
              {picking
                ? 'Click the thing to follow in the viewport. It snaps to the nearest trackable detail, then tracks the whole clip both ways from the playhead. Esc to cancel.'
                : 'Point at anything in the shot. The feature, both window sizes and the direction are measured from the footage — no boxes to place.'}
            </p>
            <Button size="sm" variant={picking ? 'secondary' : 'primary'} onClick={onArmPick} fullWidth>
              {picking ? 'Cancel pick (Esc)' : 'Pick target in viewport'}
            </Button>
            {autoPlan && (
              <Button size="sm" variant="secondary" onClick={onTrackAgain} fullWidth>
                Track again from this feature
              </Button>
            )}
          </>
        )}

        {note && !analyzing && (
          <p
            className={styles.note}
            role="status"
            data-tone={
              result || note.startsWith('Applied') || note.startsWith('Created')
                ? quality?.level === 'poor'
                  ? 'warn'
                  : undefined
                : 'error'
            }
          >
            {note}
          </p>
        )}

        {autoPlan && !analyzing && (
          <p className={styles.stats}>
            <span className={styles.stat}>
              feature <b>{Math.round(autoPlan.featureHalf) * 2 + 1}px</b>
            </span>
            <span className={styles.stat}>
              search <b>±{Math.round(autoPlan.searchHalf)}px</b>
            </span>
            {autoPlan.motionPerFrame !== null && (
              <span className={styles.stat}>
                motion <b>{autoPlan.motionPerFrame.toFixed(1)}px/f</b>
              </span>
            )}
          </p>
        )}

        {autoResult && (
          <div className={styles.actions}>
            <Button size="sm" variant="primary" onClick={() => onCreateNullAndApply()} fullWidth>
              Create null &amp; apply
            </Button>
            {result.tracks.length > 1 && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onCreateNullAndApply(true)}
                fullWidth
                title="Uses the second feature tracked alongside the first: the angle and length of the line between them carry rotation and scale."
              >
                &hellip; with rotation &amp; scale
              </Button>
            )}
            <div className={styles.actionRow}>
              <select
                className={styles.select}
                value={targetId}
                aria-label="Layer to receive the track"
                onChange={(e) => setTargetId(e.target.value)}
              >
                {targets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id === nodeId ? `${t.name || 'this layer'} (this layer)` : t.name || t.id}
                  </option>
                ))}
              </select>
              <Button size="sm" variant="secondary" onClick={onApply}>
                Apply
              </Button>
            </div>
          </div>
        )}
      </section>

      <AdvancedTracking
        nodeId={nodeId}
        src={src}
        mode={mode}
        points={points}
        featureHalf={featureHalf}
        searchHalf={searchHalf}
        dense={dense}
        stabVariant={stabVariant}
        setStabVariant={setStabVariant}
        targetId={targetId}
        setTargetId={setTargetId}
        targets={targets}
        result={result}
        tracking={tracking}
        progress={progress}
        canTrack={canTrack}
        applyLabel={applyLabel}
        maskPoints={maskPoints}
        actions={actions}
      />
    </div>
  );
}

export default TrackMotionSection;
