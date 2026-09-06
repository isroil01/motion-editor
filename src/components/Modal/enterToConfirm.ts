/**
 * Enter-to-confirm — the rule for when Enter inside a dialog means "do the
 * primary thing".
 *
 * The rule is stated once, as a pure function of the focused element, so a
 * test can enumerate the cases and so `Modal` does not grow a second copy of
 * it for the floating variant:
 *
 *  - a TEXTAREA or contenteditable owns Enter (it inserts a newline);
 *  - anything inside `[data-enter-safe]` owns Enter — a search box that
 *    submits on Enter, a value field that commits on Enter, a list that
 *    activates the highlighted row;
 *  - a BUTTON, link or summary is activated by Enter natively, and confirming
 *    on top of that would fire two things for one keypress;
 *  - a SELECT opens on Enter in some browsers;
 *  - everything else — plain inputs, checkboxes, the dialog body — confirms.
 */

/** Marker an element sets to keep Enter to itself. */
export const ENTER_SAFE_ATTR = 'data-enter-safe';
/** Marker `DialogFooter` puts on the primary button, which Enter clicks. */
export const DIALOG_PRIMARY_ATTR = 'data-dialog-primary';

export function enterShouldConfirm(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return false;
  if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return false;
  if (target.isContentEditable) return false;
  if (target.closest(`[${ENTER_SAFE_ATTR}]`)) return false;
  return true;
}

/**
 * The primary button inside `root`: one explicitly marked; else the button
 * in a `DialogFooter`'s primary slot (the slot carries the marker, so a footer
 * rendered inside the body counts too); else the primary-variant `Button` in
 * the modal's footer chrome (`Button` stamps `data-variant`).
 */
export function findPrimaryButton(root: HTMLElement | null): HTMLButtonElement | null {
  if (!root) return null;
  const el =
    root.querySelector<HTMLButtonElement>(`button[${DIALOG_PRIMARY_ATTR}]`)
    ?? root.querySelector<HTMLButtonElement>(`[${DIALOG_PRIMARY_ATTR}] button`)
    ?? root.querySelector<HTMLButtonElement>('footer button[data-variant="primary"], footer button[data-variant="danger"]');
  return el && !el.disabled ? el : null;
}
