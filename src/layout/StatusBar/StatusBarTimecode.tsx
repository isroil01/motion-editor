/**
 * The playhead readout in the status bar. Self-subscribing: the shell above
 * it must NOT re-render per frame (see the note in App.tsx), so this is the
 * one leaf that watches `time`.
 */

import { useCurrentTime } from '@stores/playbackClockStore';
import { framesToTimecode } from '@core/time/timecode';
import styles from './EditorStatusBar.module.css';

export function StatusBarTimecode({ fps, startFrame }: { fps: number; startFrame: number }): JSX.Element {
  // The playback clock store, not the project store: the project copy is
  // mirrored at 4Hz during playback and would show a readout that stutters.
  const time = useCurrentTime();
  return <span className={styles.mono}>{framesToTimecode(time, fps, startFrame)}</span>;
}
