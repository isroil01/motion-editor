/**
 * The export matrix, as the worker encodes it.
 *
 * A CommonJS port of motion-back's `src/render/render.options.ts` — the
 * worker cannot import the backend, and the two must agree byte for byte on
 * what `codec: 'prores4444', quality: 'high'` means, or a server-side render
 * and a frames-upload render of the same comp would come out as different
 * files. Keep the tables in step with that file.
 *
 *   h264        mp4/mov   web delivery; every player decodes it
 *   h265        mp4/mov   half the size; hvc1-tagged for QuickTime/Safari
 *   prores4444  mov       the mezzanine — 10-bit 4:4:4 with alpha
 *   vp9         webm      the web format with alpha
 *   gif         gif       palette-optimised, two-pass in one graph
 */

const CONTAINER_CODECS = {
  mp4: ['h264', 'h265'],
  mov: ['prores4444', 'h264', 'h265'],
  webm: ['vp9'],
  gif: ['gif'],
};

const CODEC_SUPPORTS_ALPHA = { h264: false, h265: false, prores4444: true, vp9: true, gif: true };

const CONTAINER_MIME = {
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  gif: 'image/gif',
};

const PRESET = { draft: 'veryfast', standard: 'medium', high: 'slow', max: 'slower' };
const CRF = {
  h264: { draft: 28, standard: 23, high: 18, max: 15 },
  h265: { draft: 32, standard: 27, high: 22, max: 19 },
  vp9: { draft: 40, standard: 32, high: 26, max: 20 },
};
const PRORES_Q = { draft: 15, standard: 9, high: 5, max: 2 };
const GIF_COLORS = { draft: 128, standard: 256, high: 256, max: 256 };

/** Resolve defaults and refuse impossible pairs. Throws a plain Error. */
function resolveEncode(output = {}) {
  const requestedContainer = output.container ?? output.format;
  const container =
    requestedContainer && CONTAINER_CODECS[requestedContainer]
      ? requestedContainer
      : output.codec
        ? containerFor(output.codec)
        : 'mp4';
  const allowed = CONTAINER_CODECS[container];
  const codec = output.codec ?? allowed[0];
  if (!allowed.includes(codec)) {
    throw new Error(`${codec} cannot be written into a .${container} — use ${allowed.join(' or ')}.`);
  }
  const quality = PRESET[output.quality] ? output.quality : 'standard';
  return { container, codec, quality };
}

function containerFor(codec) {
  for (const [container, codecs] of Object.entries(CONTAINER_CODECS)) {
    if (codecs[0] === codec) return container;
  }
  return 'mp4';
}

/** Whether this output wants — and can carry — an alpha channel. */
function wantsAlpha(output = {}) {
  const { codec } = resolveEncode(output);
  return Boolean(output.transparent) && CODEC_SUPPORTS_ALPHA[codec];
}

function audio(hasAudio, codec) {
  if (!hasAudio) return [];
  const rate = codec === 'aac' ? ['-b:a', '192k'] : codec === 'libopus' ? ['-b:a', '160k'] : [];
  return ['-c:a', codec, ...rate, '-shortest'];
}

/** The ffmpeg arguments between the inputs and the output path. */
function encodeArgs(output, ctx) {
  const { codec, quality } = resolveEncode(output);
  const alpha = Boolean(output.transparent) && ctx.hasAlphaFrames && CODEC_SUPPORTS_ALPHA[codec];
  const evenScale = ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2'];
  const fps = Number(ctx.fps) || 30;

  switch (codec) {
    case 'h264':
      return [
        ...evenScale,
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
        '-crf', String(CRF.h264[quality]), '-preset', PRESET[quality],
        ...audio(ctx.hasAudio, 'aac'),
        '-movflags', '+faststart',
      ];
    case 'h265':
      return [
        ...evenScale,
        '-c:v', 'libx265', '-pix_fmt', 'yuv420p',
        '-crf', String(CRF.h265[quality]), '-preset', PRESET[quality],
        '-tag:v', 'hvc1', '-x265-params', 'log-level=error',
        ...audio(ctx.hasAudio, 'aac'),
        '-movflags', '+faststart',
      ];
    case 'prores4444':
      return [
        '-c:v', 'prores_ks', '-profile:v', '4',
        '-pix_fmt', alpha ? 'yuva444p10le' : 'yuv444p10le',
        '-vendor', 'apl0', '-qscale:v', String(PRORES_Q[quality]),
        ...audio(ctx.hasAudio, 'pcm_s16le'),
      ];
    case 'vp9':
      return [
        ...(alpha ? [] : evenScale),
        '-c:v', 'libvpx-vp9', '-pix_fmt', alpha ? 'yuva420p' : 'yuv420p',
        '-crf', String(CRF.vp9[quality]), '-b:v', '0', '-row-mt', '1',
        ...(alpha ? ['-auto-alt-ref', '0'] : []),
        ...audio(ctx.hasAudio, 'libopus'),
      ];
    case 'gif':
      return [
        '-vf',
        `${fps > 30 ? 'fps=30,' : ''}split[s0][s1];[s0]palettegen=stats_mode=diff:max_colors=${GIF_COLORS[quality]}[p];[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
        '-loop', '0', '-an',
      ];
    default:
      throw new Error(`Unknown codec ${codec}`);
  }
}

module.exports = { CONTAINER_CODECS, CONTAINER_MIME, CODEC_SUPPORTS_ALPHA, resolveEncode, wantsAlpha, encodeArgs };
