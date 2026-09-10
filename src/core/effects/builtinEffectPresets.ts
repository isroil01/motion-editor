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

/** Sixty AE-style starter looks. Names are stable — do not rename lightly. */
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
  /*
    Energy Beam (2026-09-08): twenty looks for the Saber-class beam. Each is a
    full stack — the beam plus, where the look needs it, Deep Glow over it —
    tuned on a 1080p layer. Assign a mask path (or set Path to Text outline)
    and the look follows the object; the defaults draw the Start→End line so
    a preset shows something the moment it is applied.
  */
  { name: 'Lightsaber Blue', items: stack(fx('beam-path', { coreWidth: 10, coreSoftness: 20, coreColor: '#ffffff', glowColor: '#2f7bff', glowSpread: 26, glowIntensity: 160, glowBias: 40, flicker: 6, flickerRate: 24 })) },
  { name: 'Lightsaber Red', items: stack(fx('beam-path', { coreWidth: 10, coreSoftness: 20, coreColor: '#fff2f2', glowColor: '#ff2a1f', glowSpread: 26, glowIntensity: 170, glowBias: 40, flicker: 8, flickerRate: 30 })) },
  { name: 'Lightsaber Green', items: stack(fx('beam-path', { coreWidth: 10, coreSoftness: 20, coreColor: '#f4fff4', glowColor: '#35e04a', glowSpread: 26, glowIntensity: 160, glowBias: 40, flicker: 6, flickerRate: 24 })) },
  { name: 'Neon Tube', items: stack(fx('beam-path', { coreWidth: 5, coreSoftness: 40, coreColor: '#ffd6f4', glowColor: '#ff2fb3', glowSpread: 18, glowIntensity: 120, glowBias: 60 })) },
  { name: 'Neon Cyan', items: stack(fx('beam-path', { coreWidth: 5, coreSoftness: 40, coreColor: '#e8ffff', glowColor: '#19e6ff', glowSpread: 18, glowIntensity: 120, glowBias: 60 })) },
  { name: 'Electric Arc', items: stack(fx('beam-path', { coreWidth: 3, coreSoftness: 10, coreColor: '#ffffff', glowColor: '#7fb8ff', glowSpread: 22, glowIntensity: 140, glowBias: 30, distortion: 14, distortionScale: 40, flicker: 45, flickerRate: 40 })) },
  { name: 'Plasma Stream', items: stack(fx('beam-path', { coreWidth: 14, coreSoftness: 70, coreColor: '#ffe9ff', glowColor: '#b04dff', glowSpread: 40, glowIntensity: 130, glowBias: 25, distortion: 22, distortionScale: 120 })) },
  { name: 'Fire Trail', items: stack(fx('beam-path', { coreWidth: 8, coreSoftness: 60, coreColor: '#fff1a8', glowColor: '#ff6a00', glowSpread: 34, glowIntensity: 150, glowBias: 20, distortion: 18, distortionScale: 60, flicker: 25, flickerRate: 18 })) },
  { name: 'Ember Line', items: stack(fx('beam-path', { coreWidth: 3, coreSoftness: 50, coreColor: '#ffd58a', glowColor: '#ff3b00', glowSpread: 14, glowIntensity: 110, glowBias: 45, flicker: 30, flickerRate: 12 })) },
  { name: 'Laser Sight', items: stack(fx('beam-path', { coreWidth: 2, coreSoftness: 0, coreColor: '#ff3030', glowColor: '#ff1010', glowSpread: 6, glowIntensity: 90, glowBias: 80 })) },
  { name: 'Ice Beam', items: stack(fx('beam-path', { coreWidth: 8, coreSoftness: 30, coreColor: '#ffffff', glowColor: '#8ee8ff', glowSpread: 30, glowIntensity: 120, glowBias: 35, distortion: 6, distortionScale: 90 })) },
  { name: 'Golden Thread', items: stack(fx('beam-path', { coreWidth: 3, coreSoftness: 30, coreColor: '#fff6d6', glowColor: '#ffb830', glowSpread: 12, glowIntensity: 100, glowBias: 50 })) },
  { name: 'Ghost Wisp', items: stack(fx('beam-path', { coreWidth: 6, coreSoftness: 100, coreColor: '#dfffe9', glowColor: '#5fffb0', glowSpread: 36, glowIntensity: 80, glowBias: 15, distortion: 30, distortionScale: 140 })) },
  { name: 'Tracer Round', items: stack(fx('beam-path', { coreWidth: 4, coreSoftness: 20, coreColor: '#ffffff', glowColor: '#ffc266', glowSpread: 10, glowIntensity: 120, glowBias: 55, start: 70, end: 100, startSize: 30, endSize: 100 })) },
  { name: 'Tapered Slash', items: stack(fx('beam-path', { coreWidth: 16, coreSoftness: 25, coreColor: '#ffffff', glowColor: '#ff5fd2', glowSpread: 24, glowIntensity: 130, glowBias: 40, startSize: 0, endSize: 100 })) },
  { name: 'Outline Glow Text', items: stack(fx('beam-path', { source: 2, coreWidth: 3, coreSoftness: 40, coreColor: '#ffffff', glowColor: '#37b4ff', glowSpread: 16, glowIntensity: 110, glowBias: 45 })) },
  { name: 'Halo Ring', items: stack(fx('beam-path', { coreWidth: 4, coreSoftness: 60, coreColor: '#fff8e6', glowColor: '#ffd36b', glowSpread: 28, glowIntensity: 90, glowBias: 20 }), fx('deep-glow', { radius: 90, exposure: 0.5 })) },
  { name: 'Storm Wire', items: stack(fx('beam-path', { coreWidth: 2, coreSoftness: 0, coreColor: '#ffffff', glowColor: '#9fd0ff', glowSpread: 16, glowIntensity: 120, glowBias: 35, distortion: 26, distortionScale: 30, flicker: 60, flickerRate: 60 }), fx('deep-glow', { radius: 40, exposure: 0.3 })) },
  { name: 'Reveal Stroke', items: stack(fx('beam-path', { coreWidth: 6, coreSoftness: 30, coreColor: '#ffffff', glowColor: '#5aa9ff', glowSpread: 20, glowIntensity: 120, glowBias: 40, start: 0, end: 45 })) },
  { name: 'Sun Corona', items: stack(fx('beam-path', { coreWidth: 12, coreSoftness: 90, coreColor: '#fff3c4', glowColor: '#ff9a1f', glowSpread: 60, glowIntensity: 140, glowBias: 10, distortion: 40, distortionScale: 200 }), fx('deep-glow', { radius: 160, exposure: 0.8 })) },
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
