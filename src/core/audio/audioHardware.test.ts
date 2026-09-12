/**
 * Audio hardware preferences.
 *
 * The behaviour worth pinning is entirely about FAILURE. Every path here runs
 * against hardware that may have been unplugged, a permission that may have
 * been refused, and a platform that may not implement `setSinkId` at all — and
 * in every one of those cases the right answer is "keep playing", never "throw"
 * and never "fall silent". A preview that stops working because a headset was
 * removed is worse than one that moves back to the speakers.
 */

import {
  DEFAULT_AUDIO_HARDWARE,
  SYSTEM_DEFAULT_SINK,
  applyOutputDevice,
  canChooseOutput,
  getAudioHardware,
  listAudioOutputs,
  setAudioHardware,
} from './audioHardware';

const withDevices = (devices: Array<Partial<MediaDeviceInfo>>): void => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { enumerateDevices: async () => devices } },
  });
};

const withoutMediaDevices = (): void => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
};

describe('settings', () => {
  it('falls back to the defaults when settings are not booted', () => {
    // No SettingsManager in a bare unit test — and the defaults are exactly
    // what the engine did before this module existed, so falling back is not a
    // degradation.
    expect(getAudioHardware()).toEqual(DEFAULT_AUDIO_HARDWARE);
  });

  it('defaults to the system device and automatic latency', () => {
    expect(DEFAULT_AUDIO_HARDWARE.outputDeviceId).toBe(SYSTEM_DEFAULT_SINK);
    expect(DEFAULT_AUDIO_HARDWARE.latencySec).toBe(0);
  });

  it('merges a partial update rather than replacing the record', () => {
    const merged = setAudioHardware({ latencySec: 0.05 });
    expect(merged.latencySec).toBe(0.05);
    expect(merged.outputDeviceId).toBe(SYSTEM_DEFAULT_SINK);
  });

  it('does not throw out of a preferences panel when persistence fails', () => {
    expect(() => setAudioHardware({ outputDeviceId: 'abc' })).not.toThrow();
  });
});

describe('listAudioOutputs', () => {
  it('always offers System Default, even with no mediaDevices at all', async () => {
    withoutMediaDevices();
    const list = await listAudioOutputs();
    expect(list).toEqual([{ deviceId: SYSTEM_DEFAULT_SINK, label: 'System Default' }]);
  });

  it('lists real outputs after the default and ignores inputs', async () => {
    withDevices([
      { kind: 'audiooutput', deviceId: 'spk', label: 'Speakers' },
      { kind: 'audioinput', deviceId: 'mic', label: 'Microphone' },
      { kind: 'videoinput', deviceId: 'cam', label: 'Camera' },
    ]);
    const list = await listAudioOutputs();
    expect(list.map((d) => d.label)).toEqual(['System Default', 'Speakers']);
  });

  /** The spec's own 'default' id is the same thing we already list first. */
  it('does not list the platform default twice', async () => {
    withDevices([{ kind: 'audiooutput', deviceId: 'default', label: 'Default - Speakers' }]);
    expect(await listAudioOutputs()).toHaveLength(1);
  });

  /**
   * Labels are empty until microphone permission is granted — a privacy rule.
   * Numbering them lets a user try each in turn instead of facing a list of
   * identical blanks.
   */
  it('numbers unlabelled devices rather than showing blanks', async () => {
    withDevices([
      { kind: 'audiooutput', deviceId: 'a', label: '' },
      { kind: 'audiooutput', deviceId: 'b', label: '' },
    ]);
    const list = await listAudioOutputs();
    expect(list.map((d) => d.label)).toEqual(['System Default', 'Output 1', 'Output 2']);
  });

  it('survives enumeration throwing', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { mediaDevices: { enumerateDevices: async () => { throw new Error('denied'); } } },
    });
    await expect(listAudioOutputs()).resolves.toHaveLength(1);
  });
});

describe('applyOutputDevice', () => {
  const ctxWith = (setSinkId?: (id: string) => Promise<void>): AudioContext =>
    ({ ...(setSinkId ? { setSinkId } : {}) }) as unknown as AudioContext;

  it('does nothing, successfully, for the system default', async () => {
    await expect(applyOutputDevice(ctxWith(), SYSTEM_DEFAULT_SINK)).resolves.toBe(true);
  });

  /**
   * A device chosen earlier and unplugged since makes `setSinkId` reject. The
   * context keeps whatever sink it already has, so the preview carries on — the
   * failure is reported, not thrown.
   */
  it('reports failure without throwing when the device is gone', async () => {
    const ctx = ctxWith(async () => { throw new Error('NotFoundError'); });
    await expect(applyOutputDevice(ctx, 'unplugged')).resolves.toBe(false);
  });

  it('reports failure on a platform with no setSinkId', async () => {
    await expect(applyOutputDevice(ctxWith(), 'somewhere')).resolves.toBe(false);
  });

  it('routes to the chosen device when it can', async () => {
    const seen: string[] = [];
    const ctx = ctxWith(async (id) => { seen.push(id); });
    await expect(applyOutputDevice(ctx, 'spk')).resolves.toBe(true);
    expect(seen).toEqual(['spk']);
  });
});

describe('canChooseOutput', () => {
  it('answers without throwing wherever AudioContext is absent', () => {
    expect(typeof canChooseOutput()).toBe('boolean');
  });
});
