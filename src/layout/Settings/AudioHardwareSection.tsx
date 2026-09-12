/**
 * Preferences ▸ Audio — AE's Audio Hardware pane.
 *
 * Two settings, and both of them are the kind that are invisible until they are
 * wrong. Output Device is why: someone monitoring on an interface while their
 * system default is the laptop speakers previously had to change the OS setting
 * for every application to hear a preview in the right place.
 *
 * Both are read by `AudioEngine` when it BUILDS its context, which it does
 * lazily on the first sound. A context's latency cannot be changed afterwards,
 * so the note about taking effect on the next playback is a real constraint
 * rather than an apology.
 */

import { useEffect, useState } from 'react';
import {
  canChooseOutput,
  getAudioHardware,
  listAudioOutputs,
  setAudioHardware,
  type AudioOutputDevice,
} from '@core/audio/audioHardware';
import { audioEngine } from '@core/audio/AudioEngine';
import styles from './CustomizeDialog.module.css';

/** Latency choices, in ms. 0 is "let the platform decide". */
const LATENCIES: ReadonlyArray<{ ms: number; label: string }> = [
  { ms: 0, label: 'Automatic' },
  { ms: 10, label: '10 ms — lowest' },
  { ms: 25, label: '25 ms' },
  { ms: 50, label: '50 ms' },
  { ms: 100, label: '100 ms — most stable' },
];

export function AudioHardwareSection(): JSX.Element {
  const [devices, setDevices] = useState<AudioOutputDevice[]>([]);
  const [settings, setSettings] = useState(() => getAudioHardware());
  const [unlabelled, setUnlabelled] = useState(false);

  useEffect(() => {
    let alive = true;
    void listAudioOutputs().then((list) => {
      if (!alive) return;
      setDevices(list);
      // Empty labels mean the browser is withholding them until microphone
      // permission is granted. Saying so is better than showing "Output 1,
      // Output 2" and leaving the user to guess why.
      setUnlabelled(list.length > 1 && list.slice(1).every((d) => /^Output \d+$/.test(d.label)));
    });
    return () => { alive = false; };
  }, []);

  const supported = canChooseOutput();

  const update = (patch: Parameters<typeof setAudioHardware>[0]): void => {
    setSettings(setAudioHardware(patch));
  };

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>Audio Hardware</h3>

      <div className={styles.row}>
        <span className={styles.rowLabel}>Output device</span>
        <select
          className={styles.select}
          value={settings.outputDeviceId}
          disabled={!supported}
          onChange={(e) => update({ outputDeviceId: e.currentTarget.value })}
          aria-label="Audio output device"
        >
          {devices.map((d) => (
            <option key={d.deviceId || 'default'} value={d.deviceId}>{d.label}</option>
          ))}
        </select>
      </div>
      {!supported && (
        <p className={styles.rowHint}>
          This build cannot route audio to a chosen device, so previews follow
          the system default.
        </p>
      )}
      {supported && unlabelled && (
        <p className={styles.rowHint}>
          Device names are hidden until this app has been granted microphone
          access — an operating-system privacy rule, not a fault. The outputs are
          still listed and still work; pick by number if you need a specific one.
        </p>
      )}

      <div className={styles.row}>
        <span className={styles.rowLabel}>Latency</span>
        <select
          className={styles.select}
          value={String(Math.round(settings.latencySec * 1000))}
          onChange={(e) => update({ latencySec: Number(e.currentTarget.value) / 1000 })}
          aria-label="Audio latency"
        >
          {LATENCIES.map((l) => (
            <option key={l.ms} value={l.ms}>{l.label}</option>
          ))}
        </select>
      </div>
      <p className={styles.rowHint}>
        A larger buffer is steadier on a busy machine and responds to the
        transport a little later. Latency is fixed when the audio engine starts,
        so a change here applies from the next playback.
      </p>

      <div className={styles.row}>
        <span className={styles.rowLabel}>Sample rate</span>
        <span className={styles.rowValue}>
          {audioEngine.sampleRate() ? `${audioEngine.sampleRate()} Hz` : 'Not started'}
        </span>
      </div>
      <p className={styles.rowHint}>
        Reported by the audio device. Exported audio is rendered at its own fixed
        rate, so this affects monitoring only.
      </p>
    </div>
  );
}
