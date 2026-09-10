/**
 * The SAM pipeline's pure geometry — the parts a wrong constant would break
 * silently. The full two-model inference was verified against the real
 * quantized pair off-line (synthetic disc: 98.7% coverage, 0.08% leak); these
 * tests pin the coordinate contract that verification relied on, without ORT.
 */

import {
  SAM_INPUT_SIZE,
  SAM_MASK_SIZE,
  frameSignature,
  preprocessForSam,
  promptsForSam,
  samLetterbox,
  upsampleSamMask,
  wrapSamPipeline,
  type SamOrt,
  type SamSession,
} from './samPipeline';

describe('samLetterbox', () => {
  it('scales the longest side to 1024 and rounds the other', () => {
    const l = samLetterbox(640, 480);
    expect(l.resizedW).toBe(1024);
    expect(l.resizedH).toBe(768);
    expect(l.scale).toBeCloseTo(1.6);
  });

  it('is driven by height for portrait frames', () => {
    const l = samLetterbox(480, 640);
    expect(l.resizedH).toBe(1024);
    expect(l.resizedW).toBe(768);
  });
});

describe('preprocessForSam', () => {
  it('normalizes with ImageNet stats and pads with zeros', () => {
    // 2×1 frame: white pixel then black. Landscape → fills the full width.
    const rgba = Uint8Array.from([255, 255, 255, 255, 0, 0, 0, 255]);
    const out = preprocessForSam(rgba, 2, 1);
    const plane = SAM_INPUT_SIZE * SAM_INPUT_SIZE;
    expect(out.length).toBe(3 * plane);
    // White: (1 - mean)/std per channel.
    expect(out[0]).toBeCloseTo((1 - 0.485) / 0.229, 5);
    expect(out[plane]).toBeCloseTo((1 - 0.456) / 0.224, 5);
    expect(out[2 * plane]).toBeCloseTo((1 - 0.406) / 0.225, 5);
    // The pad region below the resized rows stays exactly 0 — SAM pads after
    // normalization, so a mean-subtracted zero would be wrong.
    expect(out[SAM_INPUT_SIZE * (SAM_INPUT_SIZE - 1)]).toBe(0);
  });
});

describe('promptsForSam', () => {
  it('scales points into resized-image coordinates with fg/bg labels', () => {
    const p = promptsForSam({ points: [{ x: 100, y: 50 }, { x: 10, y: 20, label: 0 }] }, 1.6);
    expect(p).not.toBeNull();
    expect(Array.from(p!.coords)).toEqual([160, 80, 16, 32]);
    expect(Array.from(p!.labels)).toEqual([1n, 0n]);
    expect(p!.count).toBe(2);
  });

  it('turns a box into its centre as a foreground point (the slimsam export has no box embeddings)', () => {
    const p = promptsForSam({ box: { x0: 30, y0: 40, x1: 10, y1: 20 } }, 2);
    expect(Array.from(p!.coords)).toEqual([40, 60]);
    expect(Array.from(p!.labels)).toEqual([1n]);
  });

  it('explicit points win over the box-derived centre', () => {
    const p = promptsForSam({ points: [{ x: 5, y: 5 }], box: { x0: 0, y0: 0, x1: 100, y1: 100 } }, 1);
    expect(p!.count).toBe(1);
    expect(Array.from(p!.coords)).toEqual([5, 5]);
  });

  it('returns null with nothing to prompt — the classical path decides then', () => {
    expect(promptsForSam({}, 1)).toBeNull();
  });
});

describe('upsampleSamMask', () => {
  it('maps frame pixels through the letterbox into the 256 grid', () => {
    // Logits: left half of the VALID region positive, right half negative.
    // Frame 512×512 → scale 2 → valid region is the whole 256 grid.
    const M = SAM_MASK_SIZE;
    const logits = new Float32Array(M * M);
    for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) logits[y * M + x] = x < M / 2 ? 4 : -4;
    const mask = upsampleSamMask(logits, 0, 512, 512, SAM_INPUT_SIZE / 512);
    expect(mask[100 * 512 + 10]).toBe(255);
    expect(mask[100 * 512 + 500]).toBe(0);
    // The boundary lands mid-frame, give or take the bilinear ramp.
    expect(mask[100 * 512 + 240]).toBe(255);
    expect(mask[100 * 512 + 272]).toBe(0);
  });
});

describe('frameSignature', () => {
  it('tells frames apart and equals itself', () => {
    const a = new Uint8Array(64 * 64 * 4).fill(10);
    const b = new Uint8Array(64 * 64 * 4).fill(11);
    expect(frameSignature(a, 64, 64)).toBe(frameSignature(a, 64, 64));
    expect(frameSignature(a, 64, 64)).not.toBe(frameSignature(b, 64, 64));
  });
});

describe('wrapSamPipeline', () => {
  const ort: SamOrt = {
    Tensor: class {
      constructor(
        public type: string,
        public data: Float32Array | BigInt64Array | Uint8Array,
        public dims: number[],
      ) {}
    },
  };

  function fakeSessions(): { encoder: SamSession; decoder: SamSession; encoderRuns: () => number } {
    let encRuns = 0;
    const M = SAM_MASK_SIZE;
    const encoder: SamSession = {
      inputNames: ['pixel_values'],
      outputNames: ['image_embeddings', 'image_positional_embeddings'],
      run: async () => {
        encRuns++;
        return {
          image_embeddings: { data: new Float32Array(1), dims: [1, 256, 64, 64] },
          image_positional_embeddings: { data: new Float32Array(1), dims: [1, 256, 64, 64] },
        };
      },
    };
    const masks = new Float32Array(3 * M * M).fill(-4);
    // Candidate 1 scores best and is all-positive → a full mask comes back.
    masks.fill(4, 1 * M * M, 2 * M * M);
    const decoder: SamSession = {
      inputNames: ['input_points', 'input_labels', 'image_embeddings', 'image_positional_embeddings'],
      outputNames: ['iou_scores', 'pred_masks'],
      run: async () => ({
        iou_scores: { data: Float32Array.from([0.2, 0.9, 0.5]), dims: [1, 1, 3] },
        pred_masks: { data: masks, dims: [1, 1, 3, M, M] },
      }),
    };
    return { encoder, decoder, encoderRuns: () => encRuns };
  }

  it('answers a click with the best-scoring candidate, and caches the embedding per frame', async () => {
    const { encoder, decoder, encoderRuns } = fakeSessions();
    const infer = wrapSamPipeline(ort, encoder, decoder);
    const rgba = new Uint8Array(16 * 16 * 4).fill(128);
    const req = { rgba, width: 16, height: 16, points: [{ x: 8, y: 8 }] };

    const mask = await infer(req);
    expect(mask).not.toBeNull();
    expect(mask!.length).toBe(16 * 16);
    expect(mask![0]).toBe(255); // candidate 1 (all-positive) won on iou

    await infer(req); // same frame, second click
    expect(encoderRuns()).toBe(1);

    await infer({ ...req, rgba: new Uint8Array(16 * 16 * 4).fill(9) });
    expect(encoderRuns()).toBe(2); // new frame re-encodes
  });

  it('returns null for a promptless request', async () => {
    const { encoder, decoder } = fakeSessions();
    const infer = wrapSamPipeline(ort, encoder, decoder);
    expect(await infer({ rgba: new Uint8Array(4), width: 1, height: 1 })).toBeNull();
  });
});
