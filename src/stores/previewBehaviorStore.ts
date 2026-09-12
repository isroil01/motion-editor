/**
 * What a preview INCLUDES — After Effects' Preview panel behaviour flags.
 *
 * AE does not have one Play button; it has several preview shortcuts, each with
 * its own behaviour, and the two that matter most are whether the preview draws
 * the picture and whether it plays the sound. Numpad `.` is "preview only
 * audio": the transport runs in real time, the sound plays, and the viewer does
 * not repaint. That is not a cosmetic setting — it is the only way to hear a
 * long comp at real speed while a heavy frame is still rendering, because with
 * the picture off there is nothing to fall behind.
 *
 * Kept OUT of `renderQualityStore` on purpose. That store answers "how good
 * should this frame look"; this one answers "should there be a frame at all".
 * Folding them together would make `includeVideo: false` look like a quality
 * level, and the render loop's quality logic would start reasoning about it.
 *
 * These flags are transient — deliberately not persisted. A project reopened
 * with the picture silently switched off would read as a broken viewport, and
 * AE resets them the same way.
 */

import { create } from 'zustand';

export interface PreviewBehaviorState {
  /** Repaint the viewer while previewing. False = AE's audio-only preview. */
  includeVideo: boolean;
  /** Play the composition's sound while previewing. */
  includeAudio: boolean;
  actions: {
    setIncludeVideo: (on: boolean) => void;
    setIncludeAudio: (on: boolean) => void;
    /** Enter audio-only (video off, audio on) — what Numpad `.` selects. */
    setAudioOnly: () => void;
    /** Back to an ordinary preview: both on. */
    reset: () => void;
  };
}

export const usePreviewBehaviorStore = create<PreviewBehaviorState>((set) => ({
  includeVideo: true,
  includeAudio: true,
  actions: {
    setIncludeVideo: (on) => set({ includeVideo: on }),
    setIncludeAudio: (on) => set({ includeAudio: on }),
    setAudioOnly: () => set({ includeVideo: false, includeAudio: true }),
    reset: () => set({ includeVideo: true, includeAudio: true }),
  },
}));

/**
 * Read the flags outside React — the render loop and the audio bridge both run
 * on their own clocks and must not subscribe.
 */
export function previewIncludesVideo(): boolean {
  return usePreviewBehaviorStore.getState().includeVideo;
}

export function previewIncludesAudio(): boolean {
  return usePreviewBehaviorStore.getState().includeAudio;
}
