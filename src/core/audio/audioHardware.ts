/**
 * Audio hardware — which device the preview plays through, and how much
 * latency the engine may trade for stability.
 *
 * After Effects' Preferences ▸ Audio Hardware. We had nothing: the preview went
 * wherever the OS default pointed, and a user monitoring on an interface while
 * their system default was the laptop speakers had no way to move it without
 * changing the setting for every application.
 *
 * ## Why the settings live here and not in the engine
 *
 * `AudioEngine` builds its context lazily, on the first sound. The device and
 * latency choices have to exist BEFORE that, and they have to survive a
 * relaunch, so they are ordinary persisted settings that the engine reads when
 * it builds. Putting them on the engine would mean the engine owned persisted
 * state, and a preferences panel would have to reach into it to write.
 *
 * ## Enumerating devices needs permission, and might get none
 *
 * `enumerateDevices` returns devices with EMPTY LABELS until the page has been
 * granted microphone permission — a privacy rule, not a bug. Asking for a
 * microphone in order to choose an output device would be a startling thing for
 * a motion-graphics app to do, so this does not: it lists what it can, and
 * labels the unnamed ones by index. The System Default entry always works and
 * is what almost everyone wants.
 */

import { getSettingsManager } from '@core/services/coreServices';

/** `setSinkId`'s value for "follow the OS". Empty string is the spec's own. */
export const SYSTEM_DEFAULT_SINK = '';

export interface AudioHardwareSettings {
  /** `deviceId` for `AudioContext.setSinkId`, or '' for the system default. */
  outputDeviceId: string;
  /**
   * Latency hint, seconds — the buffer the engine asks the platform for.
   *
   * 0 means "let the platform choose" (`interactive`). A larger value buys
   * resilience on a busy machine at the cost of a later response to the
   * transport, which is the trade AE's own Latency field makes.
   */
  latencySec: number;
}

export const DEFAULT_AUDIO_HARDWARE: AudioHardwareSettings = {
  outputDeviceId: SYSTEM_DEFAULT_SINK,
  latencySec: 0,
};

const KEY = 'audioHardware';

export function getAudioHardware(): AudioHardwareSettings {
  try {
    return { ...DEFAULT_AUDIO_HARDWARE, ...getSettingsManager().get<Partial<AudioHardwareSettings>>(KEY, {}) };
  } catch {
    // Settings not booted (tests, headless CLI). The defaults are what the
    // engine did before this existed, so falling back is not a degradation.
    return { ...DEFAULT_AUDIO_HARDWARE };
  }
}

export function setAudioHardware(next: Partial<AudioHardwareSettings>): AudioHardwareSettings {
  const merged = { ...getAudioHardware(), ...next };
  try {
    getSettingsManager().set<AudioHardwareSettings>(KEY, merged);
  } catch {
    /* unpersisted is better than throwing out of a preferences panel */
  }
  return merged;
}

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
}

/**
 * The output devices this machine offers, System Default first.
 *
 * Never throws and never returns an empty list: the System Default entry is
 * always present, so the picker has something to show even where enumeration is
 * unavailable (no `mediaDevices`, a denied permission, a headless run).
 */
export async function listAudioOutputs(): Promise<AudioOutputDevice[]> {
  const out: AudioOutputDevice[] = [
    { deviceId: SYSTEM_DEFAULT_SINK, label: 'System Default' },
  ];
  const md = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
  if (!md || typeof md.enumerateDevices !== 'function') return out;
  try {
    const devices = await md.enumerateDevices();
    let unnamed = 0;
    for (const d of devices) {
      if (d.kind !== 'audiooutput') continue;
      // The spec's own id for the default device; we already list it.
      if (d.deviceId === 'default' || d.deviceId === SYSTEM_DEFAULT_SINK) continue;
      unnamed += d.label ? 0 : 1;
      out.push({
        deviceId: d.deviceId,
        // Labels are empty until microphone permission is granted. Numbering
        // them at least lets a user try each in turn rather than seeing a list
        // of identical blanks.
        label: d.label || `Output ${unnamed}`,
      });
    }
  } catch {
    /* enumeration refused — the default entry still stands */
  }
  return out;
}

/** True when this platform can route audio to a chosen device at all. */
export function canChooseOutput(): boolean {
  return typeof AudioContext !== 'undefined'
    && typeof (AudioContext.prototype as { setSinkId?: unknown }).setSinkId === 'function';
}

/**
 * Point a context at the configured device.
 *
 * Best-effort by design. `setSinkId` rejects for a device that has been
 * unplugged since it was chosen, and the right response is to keep playing on
 * whatever the context already has rather than to fall silent — a preview that
 * stops working because a headset was removed is worse than one that moves back
 * to the speakers.
 */
export async function applyOutputDevice(ctx: AudioContext, deviceId?: string): Promise<boolean> {
  // The device is an ARGUMENT with the setting as its default, rather than
  // being read unconditionally: routing a context is one job, and deciding
  // which device to route it to is another. It also means this is testable
  // without a booted SettingsManager, which is how the three failure paths
  // below — the ones that actually matter — got covered at all.
  const outputDeviceId = deviceId ?? getAudioHardware().outputDeviceId;
  if (!outputDeviceId) return true;
  const withSink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (typeof withSink.setSinkId !== 'function') return false;
  try {
    await withSink.setSinkId(outputDeviceId);
    return true;
  } catch {
    return false;
  }
}
