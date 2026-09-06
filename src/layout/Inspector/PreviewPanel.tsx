/**
 * Preview panel — AE's Preview panel: a transport plus the playback settings.
 *
 * Every control here DRIVES something (2026-09-05). Loop, Range, Resolution
 * and Mute used to be React state that nothing read, so the panel changed
 * its own labels and nothing else — "the preview options don't work".
 *
 *   • Loop      → the timeline controller's per-comp loop flag (the same one
 *                 the transport bar's Loop Playback toggles).
 *   • Range     → the WORK AREA, which is what playback loops within: Entire
 *                 Comp clears it, From Current Time sets it from the playhead
 *                 to the end, Work Area leaves whatever the user marked.
 *   • Skip      → the step buttons advance (skip + 1) frames.
 *   • Resolution→ `renderQualityStore` — Auto keeps adaptive quality on at
 *                 Full; a fixed choice turns adaptive off at that divisor.
 *   • Mute      → the audio engine's master gain.
 *
 * Ping-pong is not offered: the controller has no bounce mode, and a menu
 * entry that silently behaves as "loop" is worse than none.
 */

import { useEffect, useState } from 'react';
import { useProjectStore } from '@stores/projectStore';
import { useCurrentTime, setTime as setPlayheadTime } from '@stores/playbackClockStore';
import { useCompositionStore } from '@stores/compositionStore';
import { useRenderQualityStore, type PreviewResolution } from '@stores/renderQualityStore';
import { getTimelineController } from '@core/timeline/TimelineController';
import { audioEngine } from '@core/audio/AudioEngine';
import { Icon } from '@components/Icon';
import { Switch } from '@components/Switch';
import { cn } from '@utils/cn';
import styles from './PreviewPanel.module.css';

type PlayRange = 'work-area' | 'entire-comp' | 'current-forward';
type ResolutionChoice = 'auto' | PreviewResolution;

export function PreviewPanel(): JSX.Element {
  const activeTabId = useProjectStore((s) => s.activeTabId);
  const playing = useProjectStore((s) => (activeTabId ? s.tabs[activeTabId]?.playing ?? false : false));
  const time = useCurrentTime();
  const setPlaying = useProjectStore((s) => s.actions.setPlaying);
  // Seeks write the transient clock; the project store is mirrored by policy.
  const setTime = (t: number, frame: number): void => {
    if (activeTabId) setPlayheadTime(activeTabId, t, frame);
  };

  const fps = useCompositionStore((s) => s.fps);
  const duration = useCompositionStore((s) => s.durationSeconds);
  const compWidth = useCompositionStore((s) => s.width);
  const compHeight = useCompositionStore((s) => s.height);

  // Loop is the controller's per-comp flag; re-read when the comp changes and
  // whenever this panel re-renders after the transport bar flipped it.
  const [looping, setLoopingState] = useState(() => getTimelineController().isLooping());
  useEffect(() => { setLoopingState(getTimelineController().isLooping()); }, [activeTabId]);
  const setLooping = (on: boolean): void => {
    getTimelineController().setLooping(on);
    setLoopingState(on);
  };

  const [range, setRangeState] = useState<PlayRange>(() => (getTimelineController().getWorkArea() ? 'work-area' : 'entire-comp'));
  const setRange = (next: PlayRange): void => {
    const tc = getTimelineController();
    if (next === 'entire-comp') tc.clearWorkArea();
    else if (next === 'current-forward') tc.setWorkArea(time, duration);
    // 'work-area' keeps whatever in/out the user marked (B / N on the timeline).
    setRangeState(next);
  };

  const [skip, setSkip] = useState<number>(0);

  const resolution = useRenderQualityStore((s) => s.resolution);
  const adaptive = useRenderQualityStore((s) => s.adaptive);
  const resolutionChoice: ResolutionChoice = adaptive ? 'auto' : resolution;
  const setResolutionChoice = (next: ResolutionChoice): void => {
    const rq = useRenderQualityStore.getState();
    if (next === 'auto') {
      rq.setAdaptive(true);
      rq.setResolution(1);
    } else {
      rq.setAdaptive(false);
      rq.setResolution(next);
    }
  };

  const [muteAudio, setMuteAudioState] = useState(() => audioEngine.isMasterMuted());
  const setMuteAudio = (muted: boolean): void => {
    audioEngine.setMasterMuted(muted);
    setMuteAudioState(muted);
  };

  const handleFirstFrame = () => {
    setTime(0, 0);
  };

  const handlePrevFrame = () => {
    const frameDuration = 1 / (fps || 30);
    const targetT = Math.max(0, time - frameDuration * (skip + 1));
    setTime(targetT, Math.round(targetT * (fps || 30)));
  };

  const handleTogglePlay = () => {
    const next = !playing;
    setPlaying(next);
    const controller = getTimelineController();
    if (next) controller.play();
    else controller.pause();
  };

  const handleNextFrame = () => {
    const frameDuration = 1 / (fps || 30);
    const targetT = Math.min(duration, time + frameDuration * (skip + 1));
    setTime(targetT, Math.round(targetT * (fps || 30)));
  };

  const handleLastFrame = () => {
    setTime(duration, Math.round(duration * (fps || 30)));
  };

  const loopLabel = looping ? 'Loop playback' : 'Play once';

  return (
    <div className={styles.root}>
      {/* ── Readout ── */}
      <div className={styles.readout}>
        <span className={styles.timecode}>{formatTimecode(time, fps || 30)}</span>
        <span className={styles.meta}>{fps || 30} fps · {compWidth}×{compHeight}</span>
      </div>

      {/* ── Transport ── */}
      <div className={styles.transport} role="toolbar" aria-label="Preview transport">
        <button type="button" className={styles.transportBtn} title="First frame (Home)" aria-label="First frame" onClick={handleFirstFrame}>
          <Icon name="skip-back" size="sm" />
        </button>
        <button type="button" className={styles.transportBtn} title="Previous frame (Page Up)" aria-label="Previous frame" onClick={handlePrevFrame}>
          <Icon name="chevron-left" size="sm" />
        </button>
        <button
          type="button"
          className={cn(styles.transportBtn, styles.transportPlay)}
          title={playing ? 'Pause (Space)' : 'Play (Space)'}
          aria-label={playing ? 'Pause' : 'Play'}
          aria-pressed={playing}
          onClick={handleTogglePlay}
        >
          <Icon name={playing ? 'pause' : 'play'} size="md" />
        </button>
        <button type="button" className={styles.transportBtn} title="Next frame (Page Down)" aria-label="Next frame" onClick={handleNextFrame}>
          <Icon name="chevron-right" size="sm" />
        </button>
        <button type="button" className={styles.transportBtn} title="Last frame (End)" aria-label="Last frame" onClick={handleLastFrame}>
          <Icon name="skip-forward" size="sm" />
        </button>
        <span className={styles.transportGap} />
        <button
          type="button"
          className={cn(styles.transportBtn, looping && styles.transportOn)}
          title={`Loop: ${loopLabel}`}
          aria-label={`Loop mode: ${loopLabel}`}
          aria-pressed={looping}
          onClick={() => setLooping(!looping)}
        >
          <Icon name={looping ? 'loop' : 'play'} size="sm" />
        </button>
      </div>

      {/* ── Playback settings ── */}
      <div className={styles.group}>
        <span className={styles.groupLabel}>Playback</span>

        <label className={styles.row}>
          <span className={styles.label}>Range</span>
          <select
            className={styles.select}
            value={range}
            onChange={(e) => setRange(e.target.value as PlayRange)}
          >
            <option value="work-area">Work Area</option>
            <option value="entire-comp">Entire Comp</option>
            <option value="current-forward">From Current Time</option>
          </select>
        </label>

        <label className={styles.row}>
          <span className={styles.label}>Skip frames</span>
          <select
            className={styles.select}
            value={skip}
            onChange={(e) => setSkip(Number(e.target.value))}
          >
            <option value={0}>0 — every frame</option>
            <option value={1}>1 — step 2 frames</option>
            <option value={2}>2 — step 3 frames</option>
            <option value={5}>5 — step 6 frames</option>
          </select>
        </label>

        <label className={styles.row}>
          <span className={styles.label}>Resolution</span>
          <select
            className={styles.select}
            value={String(resolutionChoice)}
            onChange={(e) => {
              const v = e.target.value;
              setResolutionChoice(v === 'auto' ? 'auto' : (Number(v) as PreviewResolution));
            }}
          >
            <option value="auto">Auto (adaptive)</option>
            <option value="1">Full (100%)</option>
            <option value="2">Half (50%)</option>
            <option value="3">Third (33%)</option>
            <option value="4">Quarter (25%)</option>
          </select>
        </label>

        <div className={styles.row}>
          <span className={styles.label}>Mute audio</span>
          <Switch
            checked={muteAudio}
            onChange={(e) => setMuteAudio(e.currentTarget.checked)}
            aria-label="Mute preview audio"
          />
        </div>
      </div>
    </div>
  );
}

function formatTimecode(t: number, fps: number): string {
  const totalFrames = Math.round(t * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}:${pad(frames)}`;
}

export default PreviewPanel;
