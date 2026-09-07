/**
 * Built-in effect presets — production starter looks that apply like a paste.
 *
 * These live in memory (not localStorage) so every install gets the same
 * starter set. User-saved presets still append via `listEffectPresets`.
 */

import type { CopiedEffect, EffectPreset } from './effectClipboard';
import type { Effect, EffectType } from './effects';

let seq = 0;
function fx(type: EffectType, params: Record<string, number | string | boolean>): Effect {
  return { id: `builtin_${type}_${(seq += 1)}`, type, enabled: true, params };
}

function stack(...effects: Effect[]): CopiedEffect[] {
  return effects.map((effect) => ({ effect, tracks: {} }));
}

/** Forty AE-style starter looks. Names are stable — do not rename lightly. */
export const BUILTIN_EFFECT_PRESETS: ReadonlyArray<EffectPreset> = [
  { name: 'Soft Glow', items: stack(fx('glow', { radius: 24, color: '#ffffff', intensity: 55 })) },
  { name: 'Neon Edge', items: stack(fx('glow', { radius: 12, color: '#39ff14', intensity: 90 }), fx('find-edges', { invert: true, blendWithOriginal: 35 })) },
  { name: 'Cinematic Grade', items: stack(fx('lumetri', { exposure: -0.15, contrast: 12, vibrance: 8 }), fx('vignette', { amount: 35 })) },
  { name: 'Warm Sunset', items: stack(fx('photo-filter', { density: 40, color: '#ec8a00' }), fx('tint', { amount: 20, mapWhite: '#ffe0b0' })) },
  { name: 'Cold Steel', items: stack(fx('hue-saturation', { hue: -12, saturation: -15 }), fx('contrast', { amount: 115 })) },
  { name: 'Noir', items: stack(fx('black-and-white', { reds: 40, yellows: 60, greens: 40 }), fx('contrast', { amount: 125 }), fx('add-grain', { intensity: 12 })) },
  { name: 'Film Grain', items: stack(fx('add-grain', { intensity: 28 }), fx('vignette', { amount: 20 })) },
  { name: 'Dream Soft', items: stack(fx('gaussian-blur', { blurriness: 6 }), fx('glow', { radius: 30, color: '#ffe8c8', intensity: 40 })) },
  { name: 'Pop Poster', items: stack(fx('posterize', { levels: 6 }), fx('saturate', { amount: 140 })) },
  { name: 'Ink Outline', items: stack(fx('find-edges', { invert: true, blendWithOriginal: 0 }), fx('threshold', { level: 45 })) },
  { name: 'Drop Card', items: stack(fx('drop-shadow', { distance: 10, angle: 135, softness: 18, color: '#000000', opacity: 55 })) },
  { name: 'Beveled Badge', items: stack(fx('bevel', { depth: 40, size: 4 }), fx('inner-shadow', { distance: 3, softness: 4, opacity: 40 })) },
  { name: 'Motion Streak', items: stack(fx('directional-blur', { length: 24, direction: 0 })) },
  { name: 'Zoom Burst', items: stack(fx('radial-blur', { amount: 35, blurType: 1 })) },
  { name: 'RGB Split', items: stack(fx('shift-channels', { takeRedFrom: 1, takeGreenFrom: 2, takeBlueFrom: 3, takeAlphaFrom: 0 })) },
  { name: 'Matte Cleanup', items: stack(fx('simple-choker', { chokeAmount: 1.5 }), fx('minimax', { radius: 1, operation: 0, channel: 0 })) },
  { name: 'Wipe In', items: stack(fx('linear-wipe', { completion: 50, wipeAngle: 0 })) },
  { name: 'Venetian Reveal', items: stack(fx('venetian-blinds', { completion: 40, direction: 0, width: 28 })) },
  { name: 'Light Sweep', items: stack(fx('light-sweep', { sweepWidth: 200, intensity: 70, angle: 35, position: 50 })) },
  { name: 'Unsharp Punch', items: stack(fx('unsharp-mask', { amount: 80, radius: 1.5, threshold: 2 })) },
  /*
    Round seven (2026-09-06): twenty more, most of them the FIRST thing a user
    reaches for in the effect they showcase — the AE "Animation Presets ▸
    Image - Creative / Transitions" habit of shipping an effect together with
    a look that proves it. Every value below is a setting that reads at a
    glance on a 1080p layer; the neutral defaults on the defs themselves stay
    neutral so adding the bare effect changes nothing.
  */
  { name: 'Particle Sparks', items: stack(fx('particle-systems', { birthRate: 60, longevity: 1.2, animation: 0, velocity: 420, velocityVariation: 50, gravity: 500, birthSize: 4, deathSize: 1, birthColor: '#ffe27a', deathColor: '#ff3b00', blend: 0 })) },
  { name: 'Fountain', items: stack(fx('particle-systems', { birthRate: 80, longevity: 2, animation: 2, direction: 270, spread: 25, velocity: 700, gravity: 900, birthSize: 6, deathSize: 2, birthColor: '#8fd0ff', deathColor: '#ffffff', blend: 1 })) },
  { name: 'Rising Bubbles', items: stack(fx('cc-bubbles', { bubbleAmount: 80, bubbleSize: 10, sizeVariation: 50, shading: 2, opacity: 70 })) },
  { name: 'Anaglyph 3D', items: stack(fx('3d-glasses', { convergenceOffset: 10, view: 0 })) },
  { name: 'Mandelbrot Backdrop', items: stack(fx('fractal', { setType: 0, iterations: 96, colorCycles: 3, colorPhase: 210 })) },
  { name: 'Julia Swirl', items: stack(fx('fractal', { setType: 1, juliaX: -0.8, juliaY: 0.156, iterations: 128, colorPhase: 200, colorCycles: 4 })) },
  { name: 'Sharpen Kernel', items: stack(fx('kernel', { k01: -1, k10: -1, k11: 5, k12: -1, k21: -1 })) },
  { name: 'Edge Detect Kernel', items: stack(fx('kernel', { k00: -1, k01: -1, k02: -1, k10: -1, k11: 8, k12: -1, k20: -1, k21: -1, k22: -1 })) },
  { name: 'Broadcast Safe', items: stack(fx('broadcast-colors', { standard: 0, howToMakeColorSafe: 1, maxSignalAmplitude: 110 })) },
  { name: 'Log Footage Linearize', items: stack(fx('cineon-converter', { conversionType: 0 })) },
  { name: 'Psychedelic Offset', items: stack(fx('color-offset', { redPhase: 60, greenPhase: 180, bluePhase: 300, overflow: 0 })) },
  { name: 'Three-Tone Threshold', items: stack(fx('threshold-rgb', { redLevel: 100, greenLevel: 128, blueLevel: 160 })) },
  { name: 'Loading Blocks', items: stack(fx('block-load', { completion: 40, scans: 4, blockSize: 64 })) },
  { name: 'Ripple Splash', items: stack(fx('ripple-pulse', { pulseRadius: 120, amplitude: 40, width: 60 })) },
  { name: 'Glass Reveal', items: stack(fx('glass-wipe', { completion: 50, displacement: 60, softness: 40 })) },
  { name: 'Radial Collapse', items: stack(fx('radial-scale-wipe', { completion: 40 })) },
  { name: 'Tile Wall', items: stack(fx('cc-tiler', { scale: 33 })) },
  { name: 'Green Screen Difference Key', items: stack(fx('color-difference-key', { keyColor: '#00ff00', matteInBlack: 20, matteInWhite: 230 })) },
  { name: 'HLS Film Grain', items: stack(fx('noise-hls', { noiseType: 0, lightness: 12, saturation: 4, grainSize: 1.5 })) },
  { name: 'Wire Removal', items: stack(fx('wire-removal', { thickness: 6, slope: 50 })) },
];

export function listBuiltinEffectPresets(): EffectPreset[] {
  return BUILTIN_EFFECT_PRESETS.map((p) => ({
    name: p.name,
    items: p.items.map((item) => ({
      effect: { ...item.effect, id: `fx_preset_${item.effect.type}_${(seq += 1)}` },
      tracks: {},
    })),
  }));
}
