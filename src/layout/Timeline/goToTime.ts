/**
 * The go-to-time field's grammar.
 *
 *   1:04          minutes:seconds            (2 parts)
 *   1:04:12       minutes:seconds:frames     (3 parts)
 *   0:01:04:12    hours:minutes:seconds:frames
 *   320f          frames
 *   2.5s          seconds
 *   320           frames (a whole number)
 *   2.5           seconds (a decimal)
 *   +10  -5       relative, in frames
 *   +1.5s  -0:10  relative, in the named unit
 *
 * Absolute timecodes are what the ruler DISPLAYS, so the comp's start offset
 * is subtracted to land on the domain time (see `timecode.ts`). Relative
 * values are differences and never see the offset.
 */

export interface GoToTimeContext {
  currentSeconds: number;
  fps: number;
  /** The comp's displayed start frame; 0 when the ruler starts at zero. */
  startFrame?: number;
  /** Comp length, for clamping. Omit to leave the top end open. */
  durationSeconds?: number;
}

/** Seconds, or null when the text is not a time. */
export function parseGoToTime(raw: string, ctx: GoToTimeContext): number | null {
  const fps = ctx.fps > 0 ? ctx.fps : 30;
  let text = raw.trim().toLowerCase();
  if (text === '') return null;

  let sign = 0;
  if (text.startsWith('+') || text.startsWith('-')) {
    sign = text.startsWith('+') ? 1 : -1;
    text = text.slice(1).trim();
    if (text === '') return null;
  }

  let seconds: number | null = null;
  let absoluteTimecode = false;

  if (text.includes(':')) {
    const parts = text.split(':').map((p) => p.trim());
    if (parts.length < 2 || parts.length > 4 || parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return null;
    const nums = parts.map(Number);
    let h = 0;
    let m = 0;
    let s = 0;
    let f = 0;
    if (nums.length === 2) [m, s] = nums as [number, number];
    else if (nums.length === 3) [m, s, f] = nums as [number, number, number];
    else [h, m, s, f] = nums as [number, number, number, number];
    seconds = h * 3600 + m * 60 + s + f / fps;
    absoluteTimecode = true;
  } else if (/^\d+(\.\d+)?\s*s$/.test(text)) {
    seconds = parseFloat(text);
  } else if (/^\d+(\.\d+)?\s*f$/.test(text)) {
    seconds = parseFloat(text) / fps;
  } else if (/^\d+$/.test(text)) {
    seconds = parseInt(text, 10) / fps;
  } else if (/^\d*\.\d+$/.test(text) || /^\d+\.$/.test(text)) {
    seconds = parseFloat(text);
  } else {
    return null;
  }
  if (seconds === null || !Number.isFinite(seconds)) return null;

  let result: number;
  if (sign !== 0) {
    result = ctx.currentSeconds + sign * seconds;
  } else if (absoluteTimecode) {
    result = seconds - (ctx.startFrame ?? 0) / fps;
  } else {
    result = seconds;
  }
  result = Math.max(0, result);
  if (ctx.durationSeconds !== undefined && ctx.durationSeconds > 0) result = Math.min(ctx.durationSeconds, result);
  // Land on the frame grid: the playhead is a frame, and "2.51s" should not
  // leave it between two.
  return Math.round(result * fps) / fps;
}
