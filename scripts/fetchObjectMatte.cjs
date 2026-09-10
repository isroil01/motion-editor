/**
 * Stage the bundled Object Matte assets into public/models/.
 *
 *   public/models/object-matte/  — SlimSAM encoder + decoder (Apache-2.0,
 *                                  ~14 MB, downloaded from Hugging Face)
 *   public/models/ort/           — the onnxruntime-web wasm runtime
 *                                  (~27 MB, COPIED from node_modules — the
 *                                  version must match the installed package,
 *                                  which is why it is never downloaded)
 *
 * Vite copies public/ into dist/ verbatim, electron-builder ships dist/**, and
 * `src/core/tracking/samBundled.ts` loads the files at boot. Everything here is
 * idempotent: present-and-valid files are left alone, so only the first run
 * (or a version bump that changes MODELS below) touches the network. The
 * directory is gitignored — 40 MB of weights do not belong in history.
 *
 * Runs as the first step of `electron:build` (packaging always bundles the
 * model, and a broken download fails the build loudly rather than shipping a
 * silently classical-only app). Run it by hand — `npm run fetch:objectmatte` —
 * to get the neural path in `npm run dev`.
 */

const { mkdirSync, existsSync, statSync, readFileSync, copyFileSync, renameSync, writeFileSync, unlinkSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HF = 'https://huggingface.co/Xenova/slimsam-77-uniform/resolve/main/onnx';

const MODELS = [
  { name: 'vision_encoder_quantized.onnx', url: `${HF}/vision_encoder_quantized.onnx`, minBytes: 5_000_000 },
  { name: 'prompt_encoder_mask_decoder_quantized.onnx', url: `${HF}/prompt_encoder_mask_decoder_quantized.onnx`, minBytes: 2_000_000 },
];
const MODEL_DIR = path.join(ROOT, 'public', 'models', 'object-matte');

// Both halves of the runtime: the wasm binary AND its loader module — the
// "bundle" build of ort still dynamically imports the .mjs glue at runtime.
const ORT_FILES = ['ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.jsep.mjs'];
const ORT_SRC_DIR = path.join(ROOT, 'node_modules', 'onnxruntime-web', 'dist');
const ORT_DIR = path.join(ROOT, 'public', 'models', 'ort');

/** ONNX is protobuf; field 1 (ir_version) tags the first byte 0x08. An error
 *  page is HTML and fails this immediately. */
function looksLikeOnnx(file) {
  const fd = readFileSync(file);
  return fd.length > 16 && fd[0] === 0x08;
}

function haveValid(dest, minBytes) {
  try {
    return statSync(dest).size >= minBytes && looksLikeOnnx(dest);
  } catch {
    return false;
  }
}

async function download(url, dest, minBytes) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < minBytes) throw new Error(`${url} returned ${bytes.length} bytes — too small to be the model`);
  // Write-then-rename so an interrupted download never passes haveValid().
  const tmp = `${dest}.download`;
  writeFileSync(tmp, bytes);
  if (!looksLikeOnnx(tmp)) {
    unlinkSync(tmp);
    throw new Error(`${url} did not return an ONNX file`);
  }
  renameSync(tmp, dest);
  return bytes.length;
}

async function main() {
  mkdirSync(MODEL_DIR, { recursive: true });
  mkdirSync(ORT_DIR, { recursive: true });

  // The wasm runtime: copies, refreshed whenever the package's copy differs.
  for (const name of ORT_FILES) {
    const src = path.join(ORT_SRC_DIR, name);
    if (!existsSync(src)) throw new Error(`onnxruntime-web is not installed (${src} missing) — npm install first`);
    const dest = path.join(ORT_DIR, name);
    if (!existsSync(dest) || statSync(dest).size !== statSync(src).size) {
      copyFileSync(src, dest);
      console.log(`[object-matte] staged ${name} (${(statSync(dest).size / 1e6).toFixed(1)} MB)`);
    }
  }

  for (const m of MODELS) {
    const dest = path.join(MODEL_DIR, m.name);
    if (haveValid(dest, m.minBytes)) continue;
    console.log(`[object-matte] downloading ${m.name} …`);
    const size = await download(m.url, dest, m.minBytes);
    console.log(`[object-matte] ${m.name} (${(size / 1e6).toFixed(1)} MB)`);
  }
  console.log('[object-matte] bundled model assets ready');
}

main().catch((err) => {
  console.error(`[object-matte] ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
