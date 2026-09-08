/**
 * The contract every effect ported from Canvas2D to the GPU must satisfy.
 *
 * ── Why a contract and not a test per effect ────────────────────────────────
 *
 * 112 effects are queued to move onto the GPU. A port is four coordinated edits
 * in four files, and three of the four failure modes are SILENT — the effect
 * still renders, just wrongly, on some layers and not others. Writing that
 * knowledge down once, as an assertion applied to every ported effect, is the
 * difference between a repeatable procedure and 112 chances to get it subtly
 * wrong.
 *
 * The four properties, and what breaking each one looks like:
 *
 *   1. It no longer FORCES a bake (`isGpuUnbakeableEffect` false). Miss this
 *      and the port buys nothing: every layer carrying the effect still drags
 *      the whole chain through a CPU rasterization, which was the entire
 *      reason to port it.
 *
 *   2. It KEEPS its Canvas2D implementation (`hasCanvas2dImplementation`). A
 *      layer baked for some other reason — fill opacity, a mask-scoped effect,
 *      any CPU-only effect beside it — runs its whole chain through the bake.
 *      Drop the CPU pass and the effect vanishes on exactly those layers, which
 *      is the hardest kind of bug to attribute because the effect works fine
 *      everywhere else.
 *
 *   3. It is emitted to the GPU on an UNBAKED layer. Otherwise the port is
 *      inert and the effect silently does nothing — the shape
 *      `pluginEffectsCanRender` and the extrusion scrub both had.
 *
 *   4. It is NOT emitted on a BAKED layer. The bake has already drawn it; hand
 *      it to the GPU as well and it applies TWICE. This is the one that reads
 *      as "the effect is too strong on some layers" rather than as a bug, and
 *      it is why `extractSpatialEffects(layer, true)` carries only `gpuOnly`
 *      effects — a ported effect must not be marked `gpuOnly`.
 */

import { isGpuUnbakeableEffect } from './effectBake';
import { hasCanvas2dImplementation } from './canvas2dEffects';
import { effectDefFor } from './effects';
import { extractSpatialEffects } from '@core/rendering/snapshotToFrameScene';
import type { Effect } from './effects';
import type { RenderLayer } from '@core/rendering/RenderBackend';

/**
 * Effects that have BOTH a GPU shader and a retained Canvas2D pass.
 *
 * Grows by one line per port. `apply-color-lut` and the Fill/Stroke/Sharpen/
 * Noise group are the precedents this contract was read off; `beam` is the
 * first of the 112-effect CPU population to follow them.
 */
const PORTED: ReadonlyArray<{ type: string; params: Record<string, unknown> }> = [
  { type: 'fill', params: { color: '#ff0000', opacity: 100 } },
  { type: 'stroke', params: { color: '#ff0000', width: 3 } },
  { type: 'sharpen', params: { amount: 50 } },
  { type: 'noise', params: { amount: 20, evolution: 0, monochrome: false } },
  {
    type: 'beam',
    params: { length: 100, startX: 10, startY: 50, endX: 90, endY: 50, thickness: 8, softness: 30, color: '#8fd0ff' },
  },
  {
    type: 'light-sweep',
    params: { position: 50, sweepWidth: 120, angle: 35, color: '#ffffff', intensity: 70, softness: 60, composite: 4 },
  },
  {
    type: 'lens-flare',
    params: { centerX: 48, centerY: -28, brightness: 70, scale: 1, color: '#ffd9a0' },
  },
  {
    type: 'light-rays',
    params: {
      centerX: 0, centerY: 0, rayCount: 48, rayLength: 180, spread: 100, rotation: 15,
      color: '#fff3c4', opacity: 70, falloff: 40, seed: 1, composite: 1,
    },
  },
  // ── Round six: the per-pixel colour ports ──
  {
    type: 'vignette',
    params: { amount: 55, size: 55, feather: 60, roundness: 0, centerX: 0, centerY: 0 },
  },
  {
    type: 'black-and-white',
    params: { reds: 40, yellows: 60, greens: 40, cyans: 60, blues: 20, magentas: 80, tint: false, tintColor: '#d8b48a' },
  },
  {
    type: 'tritone',
    params: { highlights: '#ffffff', midtones: '#808080', shadows: '#000000', blend: 0 },
  },
  {
    type: 'photo-filter',
    params: { color: '#ec8a00', density: 25, preserveLuminosity: true },
  },
  { type: 'threshold', params: { level: 128 } },
  { type: "mirror", params: {"centerX":0,"centerY":0,"angle":45} },
  { type: "offset", params: {"shiftX":30,"shiftY":10,"blend":0} },
  { type: "bulge", params: {"centerX":0,"centerY":0,"radius":80,"height":50} },
  { type: "twirl", params: {"centerX":0,"centerY":0,"radius":80,"angle":90} },
  { type: "spherize", params: {"centerX":0,"centerY":0,"radius":80,"amount":60} },
  { type: "kaleidoscope", params: {"segments":6,"centerX":0,"centerY":0,"rotation":0,"sourceAngle":0,"zoom":100} },
  { type: "ripple", params: {"centerX":0,"centerY":0,"radius":100,"amplitude":10,"frequency":3,"phase":0,"decay":1} },
  { type: "chromatic-aberration", params: {"amount":6,"aberrationMode":0,"angle":0,"falloff":50,"centerX":0,"centerY":0} },
  { type: "magnify", params: {"centerX":0,"centerY":0,"magnification":150,"radius":80,"shape":0,"feather":10} },
  { type: "mosaic", params: {"horizontalBlocks":20,"verticalBlocks":15,"sharpColors":false} },
  { type: "find-edges", params: {"invert":true,"blendWithOriginal":0} },
  { type: "emboss", params: {"angle":45,"relief":2,"contrast":100,"blend":0} },
  { type: "color-emboss", params: {"direction":45,"relief":2,"contrast":100,"blendWithOriginal":0} },
  { type: "halftone", params: {"cellSize":8,"screenAngle":45,"contrast":100,"inkColor":"#000000","paperColor":"#ffffff","colorize":false,"blendWithOriginal":0} },
  { type: 'vibrance', params: { vibrance: 30, saturation: 0 } },
  // ── Round seven: the footage set ──
  { type: 'gaussian-blur', params: { blurriness: 12, dimensions: 0, repeatEdge: true } },
  { type: 'fast-box-blur', params: { blurRadius: 12, iterations: 3, dimensions: 0, repeatEdge: true } },
  { type: 'radial-blur', params: { amount: 20, blurType: 0, centerX: 0, centerY: 0, quality: 16 } },
  { type: 'corner-pin', params: { topLeftX: 12, topLeftY: 0, topRightX: 0, topRightY: 0, bottomRightX: 0, bottomRightY: 0, bottomLeftX: 0, bottomLeftY: 0 } },
  { type: 'transform', params: { positionX: 8, positionY: 0, scale: 100, rotation: 0, opacity: 100 } },
  // ── Round eight: the keying set ──
  { type: 'keylight', params: { screenColor: '#00ff00', balance: 50, gain: 100, clipBlack: 8, clipWhite: 65, despill: 100, choke: 1, matteSoftness: 2 } },
  { type: 'linear-color-key', params: { keyColor: '#00ff00', matchOn: 0, tolerance: 20, softness: 10, keepMatched: false } },
  { type: 'luma-key', params: { keyType: 0, threshold: 128, tolerance: 10, softness: 10 } },
  { type: 'color-key', params: { keyColor: '#00ff00', tolerance: 15, edgeSoftness: 5 } },
  { type: 'color-range', params: { keyColor: '#00ff00', colorSpace: 0, minTolerance: 10, maxTolerance: 30, lumaWeight: 20 } },
  { type: 'extract', params: { extractChannel: 0, blackPoint: 0, whitePoint: 255, blackSoftness: 10, whiteSoftness: 10, invertExtract: false } },
  { type: 'spill-suppressor', params: { keyColor: '#00ff00', amount: 60, preserveLuma: true } },
  { type: 'simple-choker', params: { chokeAmount: 2 } },
  { type: 'matte-choker', params: { spread: 4, choke: 4, softness: 2, iterations: 1 } },
  { type: 'wave-warp', params: { waveHeight: 20, waveWidth: 120, direction: 90, phase: 0 } },
  // ── Round nine: per-pixel colour / channel / transitions ──
  { type: 'directional-blur', params: { direction: 0, length: 20 } },
  { type: 'linear-wipe', params: { completion: 40, wipeAngle: 90, feather: 10 } },
  { type: 'shift-channels', params: { takeAlphaFrom: 4, takeRedFrom: 1, takeGreenFrom: 2, takeBlueFrom: 3 } },
  { type: 'alpha-levels', params: { inBlack: 10, inWhite: 240, gamma: 1.2, outBlack: 0, outWhite: 255 } },
  { type: 'solid-composite', params: { solidColor: '#102030', sourceOpacity: 100, solidOpacity: 100, compositeMode: 0 } },
  { type: 'channel-combiner', params: { combinerMode: 0 } },
  { type: 'remove-color-matting', params: { backgroundColor: '#000000', threshold: 2, amount: 100 } },
  { type: 'change-color', params: { targetColor: '#ff0000', hueTolerance: 12, satTolerance: 60, lightTolerance: 60, softness: 50, hueShift: 60, satScale: 0, lightScale: 0, invertSelection: false } },
  { type: 'change-to-color', params: { fromColor: '#ff0000', toColor: '#0055ff', hueTolerance: 12, satTolerance: 60, lightTolerance: 60, softness: 50, preserveLightness: true } },
  { type: 'leave-color', params: { targetColor: '#ff0000', tolerance: 15, softness: 50, amount: 100 } },
  { type: 'toner', params: { blackTone: '#000000', shadowTone: '#2a2a45', midTone: '#8a7a63', highlightTone: '#e8d9b8', whiteTone: '#ffffff', blend: 0 } },
  { type: 'venetian-blinds', params: { completion: 40, direction: 0, width: 30, feather: 2 } },
  { type: 'radial-wipe', params: { completion: 40, startAngle: 0, wipe: 0, centerX: 0, centerY: 0, feather: 2 } },
  { type: 'iris-wipe', params: { completion: 40, centerX: 0, centerY: 0, irisPoints: 0, rotation: 0, innerRadius: 0, useInnerRadius: false, feather: 2, invertIris: false } },
  { type: 'line-sweep', params: { completion: 40, lineCount: 24, angle: 0, stagger: 50, feather: 2, invertSweep: false } },
  // ── Round ten: neighbourhood passes + drawn generators ──
  { type: 'channel-blur', params: { redBlurriness: 4, greenBlurriness: 0, blueBlurriness: 0, alphaBlurriness: 2, dimensions: 0, repeatEdge: false } },
  { type: 'minimax', params: { operation: 0, radius: 2, channel: 0, direction: 0 } },
  { type: 'unsharp-mask', params: { amount: 50, radius: 2, threshold: 0 } },
  { type: 'shadow-highlight', params: { shadowAmount: 50, highlightAmount: 0, radius: 30, tonalWidth: 50 } },
  { type: 'checkerboard', params: { width: 32, height: 32, anchorX: 0, anchorY: 0, colorA: '#000000', colorB: '#ffffff', opacity: 100 } },
  { type: 'grid', params: { width: 48, height: 48, anchorX: 0, anchorY: 0, thickness: 2, color: '#ffffff', opacity: 100 } },
  { type: 'four-color-gradient', params: { colorTL: '#ff0055', colorTR: '#ffcc00', colorBL: '#00d0ff', colorBR: '#7b61ff', blend: 100 } },
  { type: 'circle', params: { centerX: 0, centerY: 0, radius: 120, color: '#ffffff', opacity: 100, feather: 0, thickness: 0, invertCircle: false, composite: 0 } },
  { type: 'ellipse', params: { centerX: 0, centerY: 0, ellipseWidth: 320, ellipseHeight: 200, rotation: 0, thickness: 6, softness: 0, color: '#ffffff', opacity: 100, composite: 0 } },
  // ── Round eleven: advanced distort / transition / stylize ──
  { type: 'polar-coordinates', params: { interpolation: 100, conversion: 0 } },
  { type: 'optics-compensation', params: { fieldOfView: 60, reverse: false, centerX: 0, centerY: 0 } },
  { type: 'warp', params: { style: 0, bend: 30, horizontalDistortion: 0, verticalDistortion: 0, warpAxis: 0 } },
  { type: 'page-turn', params: { amount: 40, angle: 45, curlRadius: 60, backOpacity: 80, shading: 50 } },
  { type: 'split', params: { splitOffset: 40, angle: 0, centerX: 0, centerY: 0 } },
  { type: 'slant', params: { slant: 30, slantAxis: 0, floor: 1 } },
  { type: 'smear', params: { fromX: 0, fromY: 0, toX: 40, toY: 20, radius: 100, elasticity: 50 } },
  { type: 'rolling-shutter', params: { sweep: 30, wobble: 0, scanDirection: 0, verticalScan: false } },
  { type: 'radial-shadow', params: { lightX: -120, lightY: -120, projection: 30, shadowColor: '#000000', shadowOpacity: 60, softness: 8, renderMode: 0 } },
  { type: 'flo-motion', params: { knot1X: -100, knot1Y: 0, knot1Amount: 30, knot2X: 100, knot2Y: 0, knot2Amount: 30, falloff: 40 } },
  { type: 'lens', params: { centerX: 0, centerY: 0, size: 50, convergence: 50 } },
  { type: 'griddler', params: { tileSize: 40, horizontalScale: 80, verticalScale: 80, rotation: 10 } },
  { type: 'ball-action', params: { grid: 24, ballSize: 90, scatter: 20, seed: 1 } },
  { type: 'drizzle', params: { dripRate: 50, rippleHeight: 10, spreading: 80, evolution: 0, seed: 1 } },
  { type: 'jaws', params: { completion: 40, direction: 0, teethHeight: 20, teethWidth: 20 } },
  { type: 'pixel-polly', params: { completion: 40, cellSize: 20, gravity: 50, spin: 90, centerX: 0, centerY: 0, seed: 1 } },
  { type: 'twister', params: { completion: 40, centerY: 0, twist: 30 } },
  { type: 'card-dance', params: { rows: 6, columns: 8, amount: 50, cardRotation: 20, phase: 0 } },
  { type: 'unmult', params: { threshold: 0, boost: 100 } },
  { type: 'cc-composite', params: { opacity: 100, blendMode: 3, rgbOnly: false } },
  { type: 'cc-scatterize', params: { amount: 40, windX: 0, windY: 0, twist: 0, seed: 1 } },
  { type: 'radial-fast-blur', params: { amount: 20, centerX: 0, centerY: 0, zoomMode: 0 } },
  { type: 'cross-blur', params: { radiusX: 15, radiusY: 15, repeatEdges: true } },
  { type: 'scale-wipe', params: { completion: 50, stretch: 10, direction: 0, centerX: 0, centerY: 0 } },
  { type: 'plastic', params: { surfaceBump: 25, softness: 5, lightAngle: 45, lightIntensity: 100, specular: 50 } },
  /*
    Effects round seven. Every params object below is deliberately NON-neutral.
    Each of these fifteen skips its GPU push at the neutral setting — the same
    condition its Canvas2D handler returns early on — so a fixture left at the
    defaults would satisfy property 3 vacuously and prove nothing at all.
  */
  { type: 'cc-tiler', params: { scale: 50, centerX: 0, centerY: 0, blendWithOriginal: 0 } },
  { type: 'ripple-pulse', params: { centerX: 0, centerY: 0, pulseRadius: 60, amplitude: 30, width: 40, renderBump: true } },
  { type: 'radial-scale-wipe', params: { completion: 40, centerX: 0, centerY: 0, reverse: false } },
  { type: 'glass-wipe', params: { completion: 50, displacement: 40, softness: 30 } },
  { type: 'image-wipe', params: { completion: 50, borderSoftness: 20, gradientChannel: 0, invertGradient: false } },
  { type: 'color-difference-key', params: { keyColor: '#00ff00', matteInBlack: 10, matteInWhite: 240, matteGamma: 1, viewMode: 0 } },
  { type: 'wire-removal', params: { pointAX: -100, pointAY: 0, pointBX: 100, pointBY: 0, thickness: 4, slope: 50 } },
  { type: 'broadcast-colors', params: { standard: 0, howToMakeColorSafe: 0, maxSignalAmplitude: 110 } },
  { type: 'noise-hls', params: { noiseType: 0, hue: 20, lightness: 10, saturation: 5, grainSize: 2, noisePhase: 3 } },
  { type: 'block-load', params: { completion: 40, scans: 4, blockSize: 64 } },
  { type: 'kernel', params: { k00: 0, k01: -1, k02: 0, k10: -1, k11: 5, k12: -1, k20: 0, k21: -1, k22: 0, divisor: 1, offset: 0 } },
  { type: '3d-glasses', params: { convergenceOffset: 8, view: 0, balance: 50, swapLeftRight: false } },
  { type: 'fractal', params: { setType: 0, centerX: -0.5, centerY: 0, magnification: 1, iterations: 64, juliaX: -0.7, juliaY: 0.27, colorPhase: 0, colorCycles: 2, insideColor: '#000000' } },
  { type: 'particle-systems', params: { birthRate: 20, longevity: 1.5, producerX: 0, producerY: 0, producerRadiusX: 0, producerRadiusY: 0, animation: 0, direction: 0, spread: 60, velocity: 300, velocityVariation: 30, gravity: 200, resistance: 0, birthSize: 8, deathSize: 2, sizeVariation: 25, birthColor: '#ffe27a', deathColor: '#ff3b00', opacity: 100, blend: 0, seed: 1, time: 1 } },
  { type: 'cc-bubbles', params: { bubbleAmount: 100, bubbleSpeed: 300, wobbleAmplitude: 10, wobbleFrequency: 2, bubbleSize: 12, sizeVariation: 40, shading: 0, color: '#ffffff', opacity: 80, evolution: 100, seed: 1 } },
  { type: 'glass', params: { bumpSoftness: 4, height: 30, displacement: 12, lightAngle: 135, lightIntensity: 60, shininess: 40 } },
  { type: 'texturize', params: { pattern: 1, contrast: 80, scale: 100, lightAngle: 135 } },
  { type: 'threads', params: { thickness: 10, spacing: 2, depth: 45 } },
  { type: 'hex-tile', params: { radius: 24, border: 20 } },
  { type: 'vector-blur', params: { amount: 12, angleOffset: 0, smoothness: 2 } },
  // ── Rounds twelve + thirteen ──
  { type: 'turbulent-displace', params: { amount: 20, size: 60, complexity: 2, evolution: 0 } },
  { type: 'curl-noise', params: { amount: 20, size: 60, complexity: 3, evolution: 0 } },
  { type: 'roughen-edges', params: { border: 8, edgeSharpness: 1, scale: 100, complexity: 2, evolution: 0, seed: 1 } },
  { type: 'scatter', params: { amount: 6, grain: 0, seed: 1, evolution: 0 } },
  { type: 'colorama', params: { phaseShift: 0, palette: 0, cycleRepetitions: 1, blendWithOriginal: 0 } },
  { type: 'selective-color', params: { range: 0, cyan: 30, magenta: 0, yellow: 0, black: 0, absolute: false } },
  { type: 'turbulent-noise', params: { scale: 100, complexity: 4, evolution: 0, contrast: 100, brightness: 0, invert: false } },
  { type: 'add-grain', params: { intensity: 40, size: 1, saturation: 0, seed: 0 } },
  { type: 'median', params: { radius: 2 } },
  { type: 'dust-scratches', params: { radius: 2, threshold: 20 } },
  { type: 'block-dissolve', params: { completion: 50, blockWidth: 8, blockHeight: 8, feather: 0, seed: 1 } },
  { type: 'gradient-wipe', params: { completion: 50, softness: 10, invertGradient: false } },
  { type: 'card-wipe', params: { completion: 50, rows: 6, columns: 8, flipOrder: 0 } },
  { type: 'strobe-light', params: { strobePeriod: 1, strobeDuty: 50, strobeOperation: 0, strobeColor: '#ffffff', intensity: 100, time: 0 } },
  { type: 'burn-film', params: { burn: 40, centerX: 0, centerY: 0, burnColor: '#fff6e0', charColor: '#3d1f0a', randomness: 30, seed: 1 } },
  { type: 'light-wipe', params: { completion: 50, wipeShape: 0, angle: 0, centerX: 0, centerY: 0, lightWidth: 40, lightColor: '#ffffff', intensity: 80, feather: 8 } },
  { type: 'grid-wipe', params: { completion: 50, columns: 12, rows: 8, tileShape: 0, randomSeed: 0, feather: 2, invertGrid: false } },
  { type: 'noise-alpha', params: { amount: 40, uniformNoise: true, seed: 1, noisePhase: 0, clipResult: true } },
  { type: 'brush-strokes', params: { strokeAngle: 45, strokeLength: 8, randomness: 30, cellSize: 6, density: 100 } },
  { type: 'bilateral-blur', params: { radius: 6, colorSigma: 40, preserveAlpha: true } },
  { type: 'smart-blur', params: { radius: 6, threshold: 24, mode: 0 } },
  { type: 'camera-lens-blur', params: { radius: 6, blades: 6, irisRotation: 0, gain: 3, highlightThreshold: 80 } },
  { type: 'mesh-warp', params: { v5X: 20, v5Y: -10 } },
  { type: 'liquify', params: { centerX: 0, centerY: 0, brushSize: 80, pushX: 20, pushY: 0, twirl: 0, pinch: 0 } },
  { type: 'bezier-warp', params: { top1Y: 20 } },
  { type: 'cell-pattern', params: { size: 30, evolution: 0, contrast: 100, membrane: false, invert: false } },
  { type: 'radio-waves', params: { centerX: 0, centerY: 0, waveCount: 5, maxRadius: 0, phase: 0, thickness: 2, color: '#7dd3fc', opacity: 100, fadeOut: 50, composite: 0 } },
  { type: 'light-burst', params: { centerX: 0, centerY: 0, intensity: 100, rayLength: 50 } },
  { type: 'deep-glow', params: { radius: 60, exposure: 0, threshold: 0, aspect: 0, chromatic: 0, tint: '#ffffff', tintAmount: 0, glowOnly: false, dither: false, quality: 1 } },
  { type: 'write-on', params: { startX: -40, startY: 0, endX: 40, endY: 0, completion: 60, brushSize: 8, brushColor: '#ffffff', wobble: 20, taper: 30 } },
  { type: 'star-burst', params: { phase: 0, amount: 50, size: 3, starColor: '#ffffff', blend: 50, seed: 1 } },
  { type: 'snowfall', params: { amount: 50, size: 3, evolution: 0, wind: 0, opacity: 100, flakeColor: '#ffffff', seed: 1 } },
  { type: 'rainfall', params: { amount: 50, length: 20, angle: 10, evolution: 0, opacity: 100, rainColor: '#cfe6ff', seed: 1 } },
  { type: 'cartoon', params: { smoothness: 3, levels: 6, edgeThreshold: 25, edgeWidth: 1, edgeOpacity: 100 } },
  { type: 'inner-shadow', params: { distance: 6, angle: 120, softness: 8, color: '#000000', opacity: 75 } },
  { type: 'inner-glow', params: { size: 8, color: '#ffd070', opacity: 75 } },
  { type: 'satin', params: { distance: 8, angle: 20, size: 6, color: '#000000', opacity: 50, invert: false } },
  { type: 'bevel', params: { size: 5, depth: 100, angle: 120, altitude: 30, highlightColor: '#ffffff', highlightOpacity: 75, shadowColor: '#000000', shadowOpacity: 75 } },
  // ── Round fourteen: histogram colour autos ──
  { type: 'equalize', params: { equalizeMode: 1, amount: 100, blend: 0 } },
  { type: 'auto-levels', params: { blackClip: 0.1, whiteClip: 0.1, blend: 0 } },
  { type: 'auto-contrast', params: { blackClip: 0.1, whiteClip: 0.1, blend: 0 } },
  { type: 'auto-color', params: { blackClip: 0.1, whiteClip: 0.1, snapNeutral: 50, blend: 0 } },
];

const layerWith = (effects: Effect[]): RenderLayer =>
  ({ id: 'L', kind: 'shape', x: 0, y: 0, width: 100, height: 100, opacity: 1, effects } as unknown as RenderLayer);

describe('ported effects: GPU shader + retained Canvas2D reference', () => {
  it.each(PORTED)('$type is registered', ({ type }) => {
    expect(effectDefFor(type)).toBeDefined();
  });

  it.each(PORTED)('$type no longer forces a CPU bake', ({ type }) => {
    expect(isGpuUnbakeableEffect(type)).toBe(false);
  });

  it.each(PORTED)('$type keeps a Canvas2D pass, for layers baked anyway', ({ type }) => {
    expect(hasCanvas2dImplementation(type)).toBe(true);
  });

  it.each(PORTED)('$type reaches the GPU on an unbaked layer', ({ type, params }) => {
    const out = extractSpatialEffects(layerWith([{ id: 'fx', type, params } as unknown as Effect]));
    expect(out?.map((e) => e.type)).toContain(type);
  });

  it.each(PORTED)('$type does NOT reach the GPU on a baked layer (no double-apply)', ({ type, params }) => {
    // `true` = the baked-layer call: only gpuOnly effects survive it, because
    // the bake has already drawn everything else into the texture.
    const out = extractSpatialEffects(layerWith([{ id: 'fx', type, params } as unknown as Effect]), true);
    expect(out?.map((e) => e.type) ?? []).not.toContain(type);
  });

  it.each(PORTED)('$type is not marked gpuOnly, which is what the no-double-apply rule rests on', ({ type }) => {
    // A `gpuOnly` effect is passed through the baked-layer filter by design
    // (Displace/Motion Tile have no CPU form at all). Marking a PORTED effect
    // gpuOnly would therefore reintroduce the double-apply the test above
    // rules out — and it would still satisfy every other assertion here, which
    // is why this is asserted separately rather than trusted to follow.
    expect(effectDefFor(type)?.gpuOnly ?? false).toBe(false);
  });
});
