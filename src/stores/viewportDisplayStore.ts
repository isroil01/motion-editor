/**
 * Viewport DISPLAY state — how the stage shows the picture, none of which is
 * project data:
 *
 *   hud                  fps / frame ms / cache / resolution / backend readout
 *   displayMode          shaded · wireframe · bounding box (overlay-drawn)
 *   snapToPixel          transform results round to whole pixels (persisted)
 *   pixelAspectCorrection  scale the stage X by the footage PAR, display only
 *
 * The HUD's numbers are NOT React state: the render loop reports every frame
 * into a plain module object (`viewportHudStats`) and the HUD samples it on a
 * timer, so a 60Hz render never re-renders anything through this store.
 */

import { create } from 'zustand';

export type DisplayMode = 'shaded' | 'wireframe' | 'bounds';

export const DISPLAY_MODE_LABEL: Record<DisplayMode, string> = {
  shaded: 'Shaded',
  wireframe: 'Wireframe',
  bounds: 'Bounding box',
};

const SNAP_PIXEL_KEY = 'motion-editor.snapToPixel.v1';
const HUD_KEY = 'motion-editor.viewportHud.v1';

function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

function saveFlag(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* private mode / quota */
  }
}

interface ViewportDisplayStore {
  hud: boolean;
  displayMode: DisplayMode;
  snapToPixel: boolean;
  pixelAspectCorrection: boolean;
  setHud: (on: boolean) => void;
  toggleHud: () => void;
  setDisplayMode: (m: DisplayMode) => void;
  cycleDisplayMode: () => void;
  setSnapToPixel: (on: boolean) => void;
  toggleSnapToPixel: () => void;
  setPixelAspectCorrection: (on: boolean) => void;
  togglePixelAspectCorrection: () => void;
}

export const useViewportDisplayStore = create<ViewportDisplayStore>((set, get) => ({
  hud: loadFlag(HUD_KEY, false),
  displayMode: 'shaded',
  snapToPixel: loadFlag(SNAP_PIXEL_KEY, false),
  pixelAspectCorrection: false,
  setHud: (on) => { saveFlag(HUD_KEY, on); set({ hud: on }); },
  toggleHud: () => get().setHud(!get().hud),
  setDisplayMode: (m) => set({ displayMode: m }),
  cycleDisplayMode: () =>
    set((s) => ({ displayMode: s.displayMode === 'shaded' ? 'wireframe' : s.displayMode === 'wireframe' ? 'bounds' : 'shaded' })),
  setSnapToPixel: (on) => { saveFlag(SNAP_PIXEL_KEY, on); set({ snapToPixel: on }); },
  toggleSnapToPixel: () => get().setSnapToPixel(!get().snapToPixel),
  setPixelAspectCorrection: (on) => set({ pixelAspectCorrection: on }),
  togglePixelAspectCorrection: () => set((s) => ({ pixelAspectCorrection: !s.pixelAspectCorrection })),
}));

// ── HUD statistics ─────────────────────────────────────────────────

/** How many recent frames the rolling averages cover. */
const WINDOW = 30;

export interface HudSample {
  /** Rolling mean of the last WINDOW real renders, ms. */
  frameMs: number;
  /** The most recent real render, ms. */
  lastFrameMs: number;
  /** RAM-preview blits vs real renders since the last reset. */
  cacheHits: number;
  cacheMisses: number;
  /** Renders (of either kind) in the last second — the display's own rate. */
  fps: number;
}

class HudStats {
  private readonly ms: number[] = [];
  private hits = 0;
  private misses = 0;
  private stamps: number[] = [];

  /** Report one frame. `cacheHit` = served from the RAM preview. */
  report(frameMs: number, cacheHit: boolean, now: number = performance.now()): void {
    if (cacheHit) this.hits++;
    else {
      this.misses++;
      if (Number.isFinite(frameMs)) {
        this.ms.push(frameMs);
        if (this.ms.length > WINDOW) this.ms.shift();
      }
    }
    this.stamps.push(now);
    // Keep one second of stamps.
    while (this.stamps.length && now - this.stamps[0]! > 1000) this.stamps.shift();
  }

  sample(now: number = performance.now()): HudSample {
    while (this.stamps.length && now - this.stamps[0]! > 1000) this.stamps.shift();
    const n = this.ms.length;
    const mean = n ? this.ms.reduce((a, b) => a + b, 0) / n : 0;
    return {
      frameMs: mean,
      lastFrameMs: n ? this.ms[n - 1]! : 0,
      cacheHits: this.hits,
      cacheMisses: this.misses,
      fps: this.stamps.length,
    };
  }

  reset(): void {
    this.ms.length = 0;
    this.hits = 0;
    this.misses = 0;
    this.stamps = [];
  }
}

/** The render loop writes here; the HUD reads on a timer. */
export const viewportHudStats = new HudStats();
