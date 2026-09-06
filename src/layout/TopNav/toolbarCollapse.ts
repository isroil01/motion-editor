/**
 * Which tool groups the top bar hides at a given AVAILABLE width — the bar's
 * own width from `useElementWidth`, not the window's.
 *
 * Pure so the thresholds are tested without rendering the 800-line bar. The
 * hidden groups reappear in the overflow (`…`) dropdown; nothing is lost,
 * only demoted.
 */

export interface ToolbarCollapse {
  hidePuppet: boolean;
  hideMask: boolean;
  hideSnap: boolean;
  hideAnimate: boolean;
  hideUndoRedo: boolean;
  hideSceneControls: boolean;
}

/** Widths BELOW which each group is demoted to the overflow menu. */
export const COLLAPSE_BELOW = {
  puppet: 1200,
  mask: 1050,
  snap: 950,
  animate: 850,
  undoRedo: 850,
  sceneControls: 750,
} as const;

export function collapseFor(width: number): ToolbarCollapse {
  return {
    hidePuppet: width < COLLAPSE_BELOW.puppet,
    hideMask: width < COLLAPSE_BELOW.mask,
    hideSnap: width < COLLAPSE_BELOW.snap,
    hideAnimate: width < COLLAPSE_BELOW.animate,
    hideUndoRedo: width < COLLAPSE_BELOW.undoRedo,
    hideSceneControls: width < COLLAPSE_BELOW.sceneControls,
  };
}
