/**
 * Deep Glow's kernel arithmetic — the ONE definition both engines use.
 *
 * The GPU pass (CompositionPass → fxDeepGlow.ts) and the CPU bake
 * (src/core/effects/deepGlow.ts) must agree on the octave ladder, the tap
 * stride and the weight exponent to the last bit, or the golden gate reads a
 * different glow per route. The app imports these through `@motion/renderer`;
 * the renderer itself never imports from the app.
 */

/** Taps to each side of the centre in one separable pass (33 taps total). Mirrored as a literal in fxDeepGlow.ts. */
export const DEEP_GLOW_TAPS = 16;

/**
 * How many sigmas the taps reach. 4, not the built-in blur's 2.5: a glow's
 * whole point is its tail, and a kernel cut at 3σ (1.1 % of peak) drew a
 * visible rounded-square rim around every glow at +1.5 EV on a dark ground.
 * At 4σ the cut is 0.03 % of peak — below one 8-bit level of any glow that
 * fits the display.
 */
export const DEEP_GLOW_REACH = 4;

/**
 * The octave ladder: `sigma` of each level and the `delta` that takes the
 * previous level there (σ_k² = σ_{k−1}² + Δ_k²; level −1 is the source).
 * Sigmas double from `radius / 2^(K−1)` up to `radius`.
 */
export function deepGlowOctaves(radius: number, octaves: number): { sigma: number; delta: number }[] {
  const k = Math.max(1, Math.round(octaves));
  const out: { sigma: number; delta: number }[] = [];
  let prev = 0;
  for (let i = 0; i < k; i++) {
    const sigma = radius / Math.pow(2, k - 1 - i);
    out.push({ sigma, delta: Math.sqrt(Math.max(0, sigma * sigma - prev * prev)) });
    prev = sigma;
  }
  return out;
}

/** Integer tap stride for one pass: ±DEEP_GLOW_REACH·σ across DEEP_GLOW_TAPS taps, never finer than a texel. */
export function deepGlowStep(sigma: number): number {
  return Math.max(1, Math.ceil((DEEP_GLOW_REACH * sigma) / DEEP_GLOW_TAPS));
}

/** `1/(2σ²)` — the exponent scale a weight `exp(-x²·inv)` uses; a zero sigma keeps only the centre tap. */
export function deepGlowInv(sigma: number): number {
  return sigma <= 1e-3 ? 1e12 : 1 / (2 * sigma * sigma);
}
