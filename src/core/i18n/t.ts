/**
 * `t()` — the translation seam.
 *
 * README
 * ------
 * The app has no locale catalogue yet; every string is English and lives at
 * its call site. This function exists so that NEW code stops adding to that
 * debt: wrap a user-visible string in `t('scope.key', 'English fallback')` and
 * it renders the fallback today, exactly as a bare literal would — and the day
 * a catalogue lands, the key is already there to look up.
 *
 *   t('export.start', 'Start export')
 *   t('assets.count', '{n} assets', { n: 12 })          →  "12 assets"
 *   t('rename.prompt', 'Rename "{name}"?', { name })
 *
 * Rules for new code:
 *   • Keys are dotted, lower-case, scoped by feature: `timeline.addMarker`.
 *   • ALWAYS pass the English fallback. A key with no fallback renders the key
 *     itself, which is what you will see in the UI if you forget.
 *   • Interpolate with `{var}`; never concatenate translated fragments — word
 *     order is not universal.
 *   • Do not `t()` identifiers, file names, or values the user typed.
 *
 * Existing strings are NOT migrated by this change; do that per feature, when
 * you are in the file anyway.
 */

export type TranslationVars = Record<string, string | number>;

/**
 * A catalogue is a flat map from key to translated template. There is exactly
 * one, it is empty, and `setCatalogue` is the only way to fill it — kept
 * module-private so the seam has one entry point when the real loader comes.
 */
let catalogue: Readonly<Record<string, string>> = {};

/** Replace the active catalogue. Intended for the future locale loader and for tests. */
export function setCatalogue(next: Readonly<Record<string, string>>): void {
  catalogue = next;
}

/** `{name}` → vars.name; unknown names are left as written so a typo is visible. */
function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole,
  );
}

/**
 * Translate `key`, falling back to `fallback` (then to the key itself) and
 * interpolating `{var}` placeholders from `vars`.
 */
export function t(key: string, fallback?: string, vars?: TranslationVars): string {
  const template = catalogue[key] ?? fallback ?? key;
  return interpolate(template, vars);
}
