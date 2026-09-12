/**
 * WaveformLane — the peaks of a layer's sound, drawn across the AUDIO ▸ Waveform
 * property row (AE's `LL`).
 *
 * Why a row of its own rather than just the clip bar's waveform: the bar is the
 * drag target, so it cannot be made taller to read the sound, and it is tinted
 * by the layer's label colour, which is the wrong background for judging a
 * transient. This row is full height, untinted, and positioned on the SAME time
 * axis as the keyframe lanes above it — so a level keyframe lines up with the
 * syllable it was placed on, which is the whole point of revealing it.
 *
 * One `<svg>` per CLIP, not per layer: a split layer plays several windows onto
 * one file, and a single stretched path across the row would draw sound where
 * there is silence between the bars.
 */

import { memo, useEffect, useMemo, useState } from 'react';
import { audioEngine } from '@core/audio/AudioEngine';
import { waveformPath, peaksInRange } from '@core/audio/waveform';
import type { TimelineClip } from './TimelineModel';
import { TIMELINE_LEFT_OFFSET } from './timelineShared';
import styles from './Timeline.module.css';

/** This asset's peaks, re-read when the engine reports a decode. Mirrors the
 *  hook in `Lanes.tsx`; kept local so the lane has no import cycle with it. */
function useWaveform(assetId: string | undefined): ReturnType<typeof audioEngine.getWaveform> {
  const [wave, setWave] = useState(() => (assetId ? audioEngine.getWaveform(assetId) : undefined));
  useEffect(() => {
    if (!assetId) {
      setWave(undefined);
      return;
    }
    const read = (): void => setWave(audioEngine.getWaveform(assetId));
    read();
    return audioEngine.onChange(read);
  }, [assetId]);
  return wave;
}

function ClipWave({
  clip,
  pps,
  height,
}: {
  clip: TimelineClip;
  pps: number;
  height: number;
}): JSX.Element | null {
  const wave = useWaveform(clip.assetId);
  const width = Math.max(2, clip.duration * pps);
  const d = useMemo(() => {
    if (!wave) return '';
    const from = clip.sourceInSec;
    const to = from !== undefined ? from + clip.duration : clip.sourceOutSec;
    const slice = from !== undefined && to !== undefined ? peaksInRange(wave, from, to) : wave.peaks;
    return slice && slice.length > 0 ? waveformPath(slice, width, height) : '';
  }, [wave, clip.sourceInSec, clip.sourceOutSec, clip.duration, width, height]);
  if (!d) return null;
  return (
    <svg
      className={styles.waveformLaneSvg}
      style={{ transform: `translateX(${TIMELINE_LEFT_OFFSET + clip.start * pps}px)`, width, height }}
      aria-hidden
      focusable="false"
    >
      <path d={d} fill="currentColor" />
    </svg>
  );
}

export const WaveformLane = memo(function WaveformLane({
  clips,
  pps,
  trackHeight,
}: {
  clips: ReadonlyArray<TimelineClip>;
  pps: number;
  trackHeight: number;
}): JSX.Element {
  const height = Math.max(4, trackHeight - 6);
  return (
    <div className={styles.waveformLane}>
      {clips.map((clip) => (
        <ClipWave key={clip.id} clip={clip} pps={pps} height={height} />
      ))}
    </div>
  );
});
