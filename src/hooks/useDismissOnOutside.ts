/**
 * useDismissOnOutside — close a hand-rolled popup when the user clicks
 * anywhere outside it, or presses Escape.
 *
 * For anything new, prefer <Popover> / <Dropdown>, which do this already. This
 * is for the popups that render inline (positioned against their own chip or
 * strip) and cannot be portaled without a rewrite.
 *
 * `refs` is every element that counts as "inside": the popup itself and the
 * trigger that toggles it. The trigger MUST be listed — the listener runs on
 * the capture phase of `pointerdown`, so without it a click on the trigger
 * would close the popup here and reopen it in the trigger's own onClick.
 *
 * Capture phase, not bubble, so a popup or overlay that stops propagation on
 * its own clicks (the canvas, the timeline lanes) still dismisses this one.
 */

import { useEffect, type RefObject } from 'react';

export function useDismissOnOutside(
  open: boolean,
  refs: ReadonlyArray<RefObject<Element | null>>,
  onDismiss: () => void,
  options: { escape?: boolean } = {},
): void {
  const { escape = true } = options;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      for (const r of refs) {
        if (r.current?.contains(t)) return;
      }
      onDismiss();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('pointerdown', onDown, true);
    if (escape) window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
    // `refs` is a fresh array literal at every call site; comparing the
    // refs themselves (stable objects) keeps the effect from re-subscribing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onDismiss, escape, ...refs]);
}
