/**
 * The in-viewport HUD (View ▸ Viewport HUD, `Ctrl+Alt+H`).
 *
 * Seven numbers, in the corner of the stage, that answer "why does this feel
 * slow": the display rate, how long a real render takes, how much of that
 * rate is the RAM preview rather than the renderer, what resolution the
 * viewport is actually rendering at (which is NOT always the one you picked —
 * adaptive resolution moves it), whether adaptive is currently degrading, and
 * which GPU backend came up.
 *
 * ## Why it does not re-render sixty times a second
 *
 * The render loop reports into `viewportHudStats`, a plain module object, and
 * this samples it on a 250ms timer. Nothing about the HUD is in the render
 * path: a frame does not touch React, and turning the HUD off costs one
 * `clearInterval`.
 *
 * `FpsMeter` in the status bar is the same idea for the DISPLAY's rate and is
 * left alone — this reads the renderer's own counters instead, which is the
 * number that moves when a comp gets heavy.
 */

import { useEffect, useState } from 'react';
import {
  useViewportDisplayStore,
  viewportHudStats,
  type HudSample,
} from '@stores/viewportDisplayStore';
import {
  useRenderQualityStore,
  effectiveResolutionOf,
  RESOLUTION_LABELS,
} from '@stores/renderQualityStore';
import { useRenderBackendStore, type ActiveRenderTier } from '@stores/renderBackendStore';
import { cpuBakeStats, type CpuBakeSample } from '@core/effects/effectBake';
import styles from './ViewportHud.module.css';

/** Sampling period. Fast enough to feel live, slow enough to be readable. */
const SAMPLE_MS = 250;

/** Above this, a render is the reason the viewport is not at 60. */
const SLOW_FRAME_MS = 16.7;

const BACKEND_LABEL: Record<ActiveRenderTier, string> = {
  pending: 'starting…',
  webgpu: 'WebGPU',
  webgl2: 'WebGL2',
  null: 'none',
  software: 'software',
};

export function ViewportHud(): JSX.Element | null {
  const on = useViewportDisplayStore((s) => s.hud);
  const [sample, setSample] = useState<HudSample>(() => viewportHudStats.sample());
  const [bake, setBake] = useState<CpuBakeSample>(() => cpuBakeStats.sample());

  const quality = useRenderQualityStore((s) => s);
  const tier = useRenderBackendStore((s) => s.activeTier);

  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => { setSample(viewportHudStats.sample()); setBake(cpuBakeStats.sample()); }, SAMPLE_MS);
    return () => clearInterval(id);
  }, [on]);

  if (!on) return null;

  const effective = effectiveResolutionOf(quality);
  const degrading = effective !== quality.resolution;
  const total = sample.cacheHits + sample.cacheMisses;
  const hitPct = total > 0 ? Math.round((sample.cacheHits / total) * 100) : 0;

  return (
    <div className={styles.hud} data-viewport-hud="" aria-hidden="true">
      <span className={styles.key}>fps</span>
      <span className={styles.value}>{sample.fps}</span>

      <span className={styles.key}>frame</span>
      <span className={`${styles.value} ${sample.frameMs > SLOW_FRAME_MS ? styles.warn : ''}`}>
        {sample.frameMs.toFixed(1)} ms
      </span>

      <span className={styles.key}>cache</span>
      <span className={styles.value}>
        {hitPct}% · {sample.cacheHits}/{total}
      </span>

      <span className={styles.key}>res</span>
      <span className={`${styles.value} ${degrading ? styles.warn : ''}`}>
        {RESOLUTION_LABELS[effective]}
      </span>

      <span className={styles.key}>adaptive</span>
      <span className={styles.value}>
        {!quality.adaptive ? 'off' : degrading ? `→ ${RESOLUTION_LABELS[quality.adaptiveFloor]}` : 'ready'}
      </span>

      <span className={styles.key}>gpu</span>
      <span className={styles.value}>{BACKEND_LABEL[tier]}</span>

      {/* Layers whose effect chain ran on the CPU this frame, and the effects
          that forced it — the number behind "playback is slow with effects". */}
      <span className={styles.key}>cpu fx</span>
      <span className={`${styles.value} ${bake.bakedLayers > 0 ? styles.warn : ''}`}>
        {bake.bakedLayers === 0
          ? 'none'
          : `${bake.bakedLayers} layer${bake.bakedLayers === 1 ? '' : 's'}${bake.forcedBy.length > 0 ? ` · ${bake.forcedBy.slice(0, 3).map((f) => f.type).join(', ')}` : ''}`}
      </span>
    </div>
  );
}
