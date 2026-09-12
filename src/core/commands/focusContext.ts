/**
 * "Is the user typing?" — for commands bound to keys that mean something
 * inside a text field.
 *
 * `Tab` is the case this exists for: it opens AE's Composition Mini-Flowchart, and it is
 * also how a form moves between fields and how a menu or dialog cycles its
 * controls. `ShortcutManager` already stays out of INPUT / TEXTAREA /
 * contentEditable, but the repo rule is that a global chord beats every panel
 * listener, so the command itself must ALSO report `enabled: false` in those
 * places — a disabled command deliberately falls through to whatever else
 * wanted the key (see `ShortcutManager.onKeyDown`).
 *
 * Pure over an element so it is testable without a key event.
 */

export function isTextEntry(el: Element | null | undefined): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

/**
 * True when a key that navigates focus (Tab) must be left to the browser: a
 * text field, a menu, or a modal dialog has focus.
 */
export function focusNavigationClaimed(el: Element | null | undefined): boolean {
  if (!el || typeof el.closest !== 'function') return false;
  if (isTextEntry(el)) return true;
  return !!el.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"], [role="listbox"]');
}

/** Convenience over `document.activeElement`. */
export function focusNavigationClaimedNow(): boolean {
  return typeof document !== 'undefined' && focusNavigationClaimed(document.activeElement);
}
