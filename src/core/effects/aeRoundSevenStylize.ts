/**
 * Effects round seven — Stylize, Perspective and Generate.
 *
 *   • CC Block Load — a progressive-JPEG load, held at any point
 *   • CC Kernel     — an arbitrary 3×3 convolution
 *   • 3D Glasses    — anaglyph and stereo-pair assembly from one layer
 *   • Fractal       — Mandelbrot and Julia, drawn rather than filtered
 *
 * Fractal is the only GENERATOR of the four: it replaces the pixels inside the
 * layer box rather than transforming them, which is the same contract
 * Checkerboard and Cell Pattern hold. The other three are ordinary passes.
 */

import { clamp01, clamp255, luma } from './colorSpace';

/** Deterministic 0..1 hash of two integers — the shared one. */
function hash2(a: number, b: number): number {
  let n = (a * 374761393 + b * 668265263) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// ── CC Block Load ────────────────────────────────────────────────────────────

/**
 * CC Block Load — the picture arriving the way a progressive JPEG does: coarse
 * blocks first, each scan halving the block size, top rows finishing first.
 *
 * `completion` 100 is the fully-loaded, untouched frame, which is the opposite
 * polarity from the wipes in this round and matches AE's own control. The scan
 * a row is at comes from BOTH the completion and the row's position, so the
 * image resolves downward as well as sharpening — a version that only sharpened
 * would read as a mosaic dissolve rather than as loading.
 */
export function blockLoadData(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  completion = 100,
  scans = 4,
  blockSize = 64,
): Uint8ClampedArray {
  const t = clamp01(completion / 100);
  const out = new Uint8ClampedArray(src);
  if (t >= 1) return out;
  const nScans = Math.max(1, Math.min(8, Math.round(scans)));
  const base = Math.max(1, Math.round(blockSize));

  for (let y = 0; y < h; y++) {
    // Progress through the whole load for THIS row: rows above finish sooner.
    const rowFrac = h <= 1 ? 0 : y / h;
    const progress = t * (nScans + 1) - rowFrac;
    // Which scan this row has reached. Past the last one the row is final.
    const scan = Math.floor(progress);
    if (scan >= nScans) continue;
    if (scan < 0) {
      // Not started: the coarsest block, so the frame is never empty.
      for (let x = 0; x < w; x++) blockPixel(src, out, w, h, x, y, base);
      continue;
    }
    const size = Math.max(1, Math.round(base / Math.pow(2, scan)));
    for (let x = 0; x < w; x++) blockPixel(src, out, w, h, x, y, size);
  }
  return out;
}

/** One destination pixel painted with the colour at its block's centre. */
function blockPixel(
  src: Uint8ClampedArray,
  out: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number,
  size: number,
): void {
  // The block CENTRE, not its corner: a corner sample makes every block carry
  // the edge pixel of whatever is to its upper left, which reads as a shift.
  const bx = Math.min(w - 1, Math.floor(x / size) * size + Math.floor(size / 2));
  const by = Math.min(h - 1, Math.floor(y / size) * size + Math.floor(size / 2));
  const s = (by * w + bx) * 4;
  const d = (y * w + x) * 4;
  out[d] = src[s]!;
  out[d + 1] = src[s + 1]!;
  out[d + 2] = src[s + 2]!;
  out[d + 3] = src[s + 3]!;
}

// ── CC Kernel ────────────────────────────────────────────────────────────────

/**
 * CC Kernel — a 3×3 convolution with every tap exposed.
 *
 * Alpha is NOT convolved. Running the kernel over coverage as well turns a
 * sharpen into an edge-ringing matte and an emboss into a hole, and AE's own
 * Kernel effects leave alpha alone for the same reason. Edges clamp.
 */
export function kernelConvolveData(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  k: readonly number[],
  divisor = 1,
  offset = 0,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  const div = Math.abs(divisor) < 0.0001 ? 1 : divisor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let acc = 0;
        for (let j = -1; j <= 1; j++) {
          for (let i = -1; i <= 1; i++) {
            const xx = Math.max(0, Math.min(w - 1, x + i));
            const yy = Math.max(0, Math.min(h - 1, y + j));
            acc += src[(yy * w + xx) * 4 + c]! * k[(j + 1) * 3 + (i + 1)]!;
          }
        }
        out[o + c] = clamp255(acc / div + offset);
      }
    }
  }
  return out;
}

// ── 3D Glasses ───────────────────────────────────────────────────────────────

/**
 * 3D Glasses — assemble a stereo view out of ONE layer.
 *
 * AE's own effect takes two source layers. This one synthesises the second eye
 * by shifting the layer horizontally, which is what makes it usable on ordinary
 * footage: a real stereo pair is rare, and the convergence offset is the only
 * control most people touch anyway. `swapLeftRight` therefore flips the sign of
 * the shift rather than exchanging two inputs.
 */
export function glasses3dData(
  src: Uint8ClampedArray,
  w: number,
  h: number,
  convergenceOffset = 8,
  view = 0,
  balance = 50,
  swapLeftRight = false,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  const shift = swapLeftRight ? -convergenceOffset : convergenceOffset;
  const at = (x: number, y: number, c: number): number => {
    const xi = Math.max(0, Math.min(w - 1, Math.round(x)));
    const yi = Math.max(0, Math.min(h - 1, Math.round(y)));
    return src[(yi * w + xi) * 4 + c]!;
  };
  const bal = clamp01(balance / 100);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      // Two eyes, half the convergence each way, so the effect is centred.
      const lx = x - shift / 2;
      const rx = x + shift / 2;
      const lr = at(lx, y, 0); const lg = at(lx, y, 1); const lb = at(lx, y, 2);
      const rr = at(rx, y, 0); const rg = at(rx, y, 1); const rb = at(rx, y, 2);
      const la = at(lx, y, 3); const ra = at(rx, y, 3);

      switch (view) {
        case 1: // Red Green
          out[o] = lr; out[o + 1] = rg; out[o + 2] = 0; break;
        case 2: // Red Blue
          out[o] = lr; out[o + 1] = 0; out[o + 2] = rb; break;
        case 3: {
          // Balanced Colored Red Blue — the left eye's red is mixed with its
          // own luminance so the classic red-channel retinal rivalry eases off.
          const lLum = luma(lr, lg, lb);
          out[o] = clamp255(lr * (1 - bal) + lLum * bal);
          out[o + 1] = clamp255(rg * bal);
          out[o + 2] = rb;
          break;
        }
        case 4: { // Stereo Pair — both eyes squeezed side by side.
          const half = w / 2;
          const srcX = x < half ? (x / half) * w : ((x - half) / half) * w;
          const eyeShift = x < half ? -shift / 2 : shift / 2;
          out[o] = at(srcX + eyeShift, y, 0);
          out[o + 1] = at(srcX + eyeShift, y, 1);
          out[o + 2] = at(srcX + eyeShift, y, 2);
          out[o + 3] = at(srcX + eyeShift, y, 3);
          continue;
        }
        case 5: { // Interlace Upper L Lower R
          const useLeft = y % 2 === 0;
          out[o] = useLeft ? lr : rr;
          out[o + 1] = useLeft ? lg : rg;
          out[o + 2] = useLeft ? lb : rb;
          out[o + 3] = useLeft ? la : ra;
          continue;
        }
        default: // Red Cyan
          out[o] = lr; out[o + 1] = rg; out[o + 2] = rb; break;
      }
      // Both eyes contribute, so a pixel is covered where EITHER is.
      out[o + 3] = Math.max(la, ra);
    }
  }
  return out;
}

// ── Fractal ──────────────────────────────────────────────────────────────────

/**
 * Fractal — Mandelbrot and Julia, drawn into the layer box.
 *
 * A GENERATOR: it replaces the pixels rather than filtering them, exactly as
 * Checkerboard and Cell Pattern do, so an empty solid is the normal host layer.
 *
 * The escape count is SMOOTHED (`n + 1 - log2(log2|z|)`) before it becomes a
 * hue. Without that the bands are integers and the picture is a set of hard
 * contour rings, which is the single thing that separates a fractal that looks
 * rendered from one that looks plotted.
 *
 * `Math.fround` is applied to the iteration variables on purpose: the GPU twin
 * runs in f32, and an f64 reference would diverge visibly at high magnification
 * — the point where an escape count differs by one is a whole colour band.
 */
export function fractalData(
  w: number,
  h: number,
  setType = 0,
  centerX = -0.5,
  centerY = 0,
  magnification = 1,
  iterations = 64,
  juliaX = -0.7,
  juliaY = 0.27,
  colorPhase = 0,
  colorCycles = 2,
  insideR = 0,
  insideG = 0,
  insideB = 0,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const maxIter = Math.max(1, Math.min(256, Math.round(iterations)));
  const mag = Math.max(0.1, magnification);
  // The classic window is ±2 on the SHORTER side, so the framing does not
  // change when the layer's aspect does.
  const scale = 4 / (Math.min(w, h) * mag);
  const phase = colorPhase / 360;
  const cycles = Math.max(0.1, colorCycles);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const px = (x + 0.5 - w / 2) * scale + centerX;
      const py = (y + 0.5 - h / 2) * scale + centerY;

      let zr: number;
      let zi: number;
      let cr: number;
      let ci: number;
      if (setType === 1) {
        zr = px; zi = py; cr = juliaX; ci = juliaY;
      } else {
        zr = 0; zi = 0; cr = px; ci = py;
      }

      let n = 0;
      let zr2 = Math.fround(zr * zr);
      let zi2 = Math.fround(zi * zi);
      while (n < maxIter && zr2 + zi2 <= 256) {
        zi = Math.fround(2 * zr * zi + ci);
        zr = Math.fround(zr2 - zi2 + cr);
        zr2 = Math.fround(zr * zr);
        zi2 = Math.fround(zi * zi);
        n++;
      }

      if (n >= maxIter) {
        out[o] = clamp255(insideR);
        out[o + 1] = clamp255(insideG);
        out[o + 2] = clamp255(insideB);
        out[o + 3] = 255;
        continue;
      }
      // Smooth iteration count — the escape radius is 16, so |z|² is at least
      // 256 and both logs are safely positive.
      const modulus = Math.sqrt(zr2 + zi2);
      const smooth = n + 1 - Math.log(Math.log(modulus) / Math.log(2)) / Math.log(2);
      const hue = ((phase + (smooth / maxIter) * cycles) % 1 + 1) % 1;
      const [r, g, b] = hueToRgb(hue);
      out[o] = clamp255(r);
      out[o + 1] = clamp255(g);
      out[o + 2] = clamp255(b);
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Full-saturation, full-value hue → RGB 0..255. The escape-count palette. */
function hueToRgb(hue: number): [number, number, number] {
  const h6 = hue * 6;
  const i = Math.floor(h6) % 6;
  const f = h6 - Math.floor(h6);
  const q = 1 - f;
  switch (i) {
    case 0: return [255, f * 255, 0];
    case 1: return [q * 255, 255, 0];
    case 2: return [0, 255, f * 255];
    case 3: return [0, q * 255, 255];
    case 4: return [f * 255, 0, 255];
    default: return [255, 0, q * 255];
  }
}

/** Exported so the simulation module and the tests share one hash. */
export { hash2 };
