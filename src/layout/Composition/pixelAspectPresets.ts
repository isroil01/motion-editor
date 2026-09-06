/**
 * The composition pixel-aspect catalog — the same seven entries After Effects
 * offers in Composition Settings ▸ Pixel Aspect Ratio, with AE's numbers.
 *
 * These are RATIOS OF ONE COMP PIXEL (width ÷ height), not footage
 * interpretations. Footage pixel aspect is applied once at import
 * (`sourceInfo.displaySize` multiplies the stored width by `interpret.par`),
 * so a layer is already the right shape before it ever reaches a comp; this
 * list is for the other job — authoring FOR a non-square delivery raster.
 *
 * The values are the ITU-R BT.601 derived ones AE ships, not the naive
 * 720×480 → 4:3 arithmetic:
 *
 *   D1/DV NTSC            10/11    = 0.9091
 *   D1/DV NTSC Widescreen 40/33    = 1.2121
 *   D1/DV PAL             59/54    = 1.0940
 *   D1/DV PAL Widescreen  118/81   = 1.4587
 *   HDV / DVCPRO HD       4/3      = 1.3333  (1440×1080 shown as 1920×1080)
 *   Anamorphic 2:1        2        (a 2× squeeze lens)
 *
 * Rounded to four decimals deliberately, so a document round-trips as the
 * number the dialog shows rather than as a 17-digit float nobody typed.
 */

export interface PixelAspectPreset {
  id: string;
  /** What it is, in the user's terms — matches the label AE uses. */
  label: string;
  /** One pixel's width ÷ its height. */
  value: number;
  /** Where it comes from, shown as the secondary line. */
  note?: string;
}

export const PIXEL_ASPECT_PRESETS: readonly PixelAspectPreset[] = [
  { id: 'square', label: 'Square Pixels', value: 1, note: 'every digital format made this century' },
  { id: 'd1_ntsc', label: 'D1/DV NTSC', value: 0.9091, note: '10:11 · 720×480 standard definition' },
  { id: 'd1_ntsc_wide', label: 'D1/DV NTSC Widescreen', value: 1.2121, note: '40:33 · 720×480 anamorphic 16:9' },
  { id: 'd1_pal', label: 'D1/DV PAL', value: 1.094, note: '59:54 · 720×576 standard definition' },
  { id: 'd1_pal_wide', label: 'D1/DV PAL Widescreen', value: 1.4587, note: '118:81 · 720×576 anamorphic 16:9' },
  { id: 'hdv', label: 'HDV/DVCPRO HD', value: 1.3333, note: '4:3 · 1440×1080 shown as 1920×1080' },
  { id: 'anamorphic_2_1', label: 'Anamorphic 2:1', value: 2, note: 'a 2× squeeze lens, unsqueezed on projection' },
];

/** Ratios closer than this count as the same preset. */
const PAR_EPSILON = 5e-4;

/** The preset a value IS, or undefined when it is a custom number. */
export function findPixelAspectPreset(value: number): PixelAspectPreset | undefined {
  return PIXEL_ASPECT_PRESETS.find((p) => Math.abs(p.value - value) < PAR_EPSILON);
}

/**
 * "1.2121 (D1/DV NTSC Widescreen)" / "1.5000 (custom)" — the reassurance line.
 * Four decimals because that is the precision the catalog is stated at, and a
 * value that reads `1.21` would be indistinguishable from three real presets.
 */
export function describePixelAspect(value: number): string {
  const preset = findPixelAspectPreset(value);
  return `${value.toFixed(4)} (${preset ? preset.label : 'custom'})`;
}
