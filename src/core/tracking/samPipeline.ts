/**
 * The real SAM pipeline — two models, one click.
 *
 * SAM-class checkpoints do not ship as "image in, mask out". They ship as an
 * ENCODER (image → embeddings, the expensive pass) and a DECODER (embeddings +
 * point prompts → candidate masks, milliseconds). The previous ONNX wrapper in
 * `samOnnxLoader.ts` fed the whole frame to a single session and hoped for a
 * mask-shaped output — which no published SAM export answers, so every click
 * quietly fell through to GrabCut. This module speaks the actual protocol,
 * matched to the transformers.js export layout (Xenova/slimsam-*):
 *
 *   vision_encoder:  pixel_values [1,3,1024,1024] → image_embeddings,
 *                    image_positional_embeddings           (both [1,256,64,64])
 *   decoder:         input_points [1,1,N,2] f32 (RESIZED-image coords),
 *                    input_labels [1,1,N] i64 (1 fg, 0 bg, 2/3 box corners)
 *                    → iou_scores [1,1,3], pred_masks [1,1,3,256,256] (logits)
 *
 * Preprocess is SAM's own: longest side to 1024, bottom/right zero-pad,
 * ImageNet mean/std. Verified end-to-end against the bundled quantized pair
 * (synthetic disc, 98.7% coverage / 0.08% leak) before this file was written.
 *
 * The embedding is cached for the last frame seen: the encoder is ~seconds on
 * WASM while the decoder is instant, and Roto clicks come in bursts on one
 * frame. The cache key samples the pixels rather than hashing all of them —
 * a stride of the buffer is plenty to tell two video frames apart.
 */

import type { SamSegmentRequest } from './samSegment';

/** SAM's fixed encoder input edge. */
export const SAM_INPUT_SIZE = 1024;
/** The decoder's fixed low-res mask edge (SAM_INPUT_SIZE / 4). */
export const SAM_MASK_SIZE = 256;

const MEAN = [0.485, 0.456, 0.406] as const;
const STD = [0.229, 0.224, 0.225] as const;

/** How a w×h frame lands inside the 1024×1024 encoder input. */
export function samLetterbox(width: number, height: number): {
  scale: number;
  resizedW: number;
  resizedH: number;
} {
  const scale = SAM_INPUT_SIZE / Math.max(width, height);
  return {
    scale,
    resizedW: Math.round(width * scale),
    resizedH: Math.round(height * scale),
  };
}

/**
 * RGBA frame → normalized NCHW planes in the padded 1024² square.
 *
 * Nearest-neighbour resample: the encoder immediately patchifies to 16×16
 * tokens, and the difference bilinear would make is below what the quantized
 * weights resolve — measured masks come out the same.
 */
export function preprocessForSam(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Float32Array {
  const { scale, resizedW, resizedH } = samLetterbox(width, height);
  const T = SAM_INPUT_SIZE;
  const plane = T * T;
  // Zero-filled: SAM's processor pads with 0 AFTER normalization.
  const out = new Float32Array(3 * plane);
  for (let y = 0; y < resizedH; y++) {
    const sy = Math.min(height - 1, Math.round(y / scale));
    for (let x = 0; x < resizedW; x++) {
      const sx = Math.min(width - 1, Math.round(x / scale));
      const s = (sy * width + sx) * 4;
      const d = y * T + x;
      out[d] = (rgba[s]! / 255 - MEAN[0]) / STD[0];
      out[plane + d] = (rgba[s + 1]! / 255 - MEAN[1]) / STD[1];
      out[2 * plane + d] = (rgba[s + 2]! / 255 - MEAN[2]) / STD[2];
    }
  }
  return out;
}

/**
 * Prompts in the decoder's coordinate space (the RESIZED image, not the frame
 * and not the padded square — SAM's processor scales points by the same factor
 * as the pixels). Box corners use SAM's reserved labels 2 (top-left) and
 * 3 (bottom-right).
 */
export function promptsForSam(
  req: Pick<SamSegmentRequest, 'points' | 'box'>,
  scale: number,
): { coords: Float32Array; labels: BigInt64Array; count: number } | null {
  const coords: number[] = [];
  const labels: bigint[] = [];
  for (const p of req.points ?? []) {
    coords.push(p.x * scale, p.y * scale);
    labels.push((p.label ?? 1) === 1 ? 1n : 0n);
  }
  if (req.box) {
    coords.push(
      Math.min(req.box.x0, req.box.x1) * scale,
      Math.min(req.box.y0, req.box.y1) * scale,
      Math.max(req.box.x0, req.box.x1) * scale,
      Math.max(req.box.y0, req.box.y1) * scale,
    );
    labels.push(2n, 3n);
  }
  if (labels.length === 0) return null;
  return {
    coords: Float32Array.from(coords),
    labels: BigInt64Array.from(labels),
    count: labels.length,
  };
}

/**
 * One 256×256 logit plane → a w×h binary mask.
 *
 * The logits cover the padded 1024² square at quarter resolution, so a frame
 * pixel (x,y) reads the plane at (x·scale/4, y·scale/4). Sampled bilinearly in
 * LOGIT space and thresholded at 0 after — thresholding first would turn the
 * soft neural boundary into 4px staircase blocks.
 */
export function upsampleSamMask(
  logits: ArrayLike<number>,
  offset: number,
  width: number,
  height: number,
  scale: number,
): Uint8Array {
  const M = SAM_MASK_SIZE;
  const out = new Uint8Array(width * height);
  const step = scale / (SAM_INPUT_SIZE / M);
  for (let y = 0; y < height; y++) {
    const fy = Math.min(M - 1.001, y * step);
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(M - 1.001, x * step);
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const i00 = Number(logits[offset + y0 * M + x0]);
      const i10 = Number(logits[offset + y0 * M + x0 + 1]);
      const i01 = Number(logits[offset + (y0 + 1) * M + x0]);
      const i11 = Number(logits[offset + (y0 + 1) * M + x0 + 1]);
      const v = i00 * (1 - tx) * (1 - ty) + i10 * tx * (1 - ty) + i01 * (1 - tx) * ty + i11 * tx * ty;
      out[y * width + x] = v > 0 ? 255 : 0;
    }
  }
  return out;
}

/** Cheap frame identity: dims + a strided FNV-1a over the pixels. */
export function frameSignature(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): string {
  let h = 0x811c9dc5;
  const stride = Math.max(4, (rgba.length >> 12) & ~3); // ~4096 samples, pixel-aligned
  for (let i = 0; i < rgba.length; i += stride) {
    h ^= rgba[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return `${width}x${height}:${(h >>> 0).toString(16)}`;
}

// ── Session plumbing ──────────────────────────────────────────────────────
//
// Structural types only — the ort namespace arrives via dynamic import in
// samOnnxLoader.ts and is passed in, never imported here.

interface OrtTensorLike {
  data: ArrayLike<number>;
  dims: number[];
}
export interface SamSession {
  run: (feeds: Record<string, unknown>) => Promise<Record<string, OrtTensorLike>>;
  inputNames: string[];
  outputNames: string[];
}
export interface SamOrt {
  Tensor: new (
    type: string,
    data: Float32Array | BigInt64Array | Uint8Array,
    dims: number[],
  ) => unknown;
}

interface EmbeddingCacheEntry {
  key: string;
  embeddings: unknown;
  positional: unknown;
}

/**
 * Build the click→mask inferrer `registerSamOnnxSession` expects from an
 * encoder/decoder session pair. Returns null (→ classical fallback) rather
 * than throwing: a prompt the decoder cannot answer should degrade, not error.
 */
export function wrapSamPipeline(
  ort: SamOrt,
  encoder: SamSession,
  decoder: SamSession,
): (req: SamSegmentRequest) => Promise<Uint8Array | null> {
  let cache: EmbeddingCacheEntry | null = null;

  return async (req) => {
    const { width, height, rgba } = req;
    const { scale } = samLetterbox(width, height);
    const prompts = promptsForSam(req, scale);
    if (!prompts) return null;

    const key = frameSignature(rgba, width, height);
    if (!cache || cache.key !== key) {
      const pixels = preprocessForSam(rgba, width, height);
      const encOut = await encoder.run({
        pixel_values: new ort.Tensor('float32', pixels, [1, 3, SAM_INPUT_SIZE, SAM_INPUT_SIZE]),
      });
      const embeddings = encOut['image_embeddings'];
      const positional = encOut['image_positional_embeddings'];
      if (!embeddings || !positional) return null;
      cache = { key, embeddings, positional };
    }

    const decOut = await decoder.run({
      input_points: new ort.Tensor('float32', prompts.coords, [1, 1, prompts.count, 2]),
      input_labels: new ort.Tensor('int64', prompts.labels, [1, 1, prompts.count]),
      image_embeddings: cache.embeddings,
      image_positional_embeddings: cache.positional,
    });
    const scores = decOut['iou_scores'];
    const masks = decOut['pred_masks'];
    if (!scores || !masks) return null;

    // Three candidate masks per prompt set; the model scores its own guesses.
    let best = 0;
    for (let i = 1; i < scores.data.length; i++) {
      if (Number(scores.data[i]) > Number(scores.data[best])) best = i;
    }
    return upsampleSamMask(masks.data, best * SAM_MASK_SIZE * SAM_MASK_SIZE, width, height, scale);
  };
}
