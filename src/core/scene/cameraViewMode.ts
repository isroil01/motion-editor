/**
 * "Look through a specific camera" view modes — After Effects' 3D View list,
 * where every camera in the comp appears by name under Active Camera.
 *
 * The mode is a STRING, `camera:<nodeId>`, so it lives in the same union as
 * 'active', the six axis views and the three custom views. Every place that
 * already carries a view mode — the main viewport, the 2-up and 4-up panes,
 * per-view framing, bookmarks, the render key — carries this one for free,
 * instead of a second "which camera" field that each of them would have to
 * remember to thread alongside the first.
 *
 * Pure and graph-free on purpose: string helpers only, importable from the
 * renderer, the stores and the chrome without dragging the scene in. Which
 * NODE a camera view resolves to — and the fallback when it cannot — is
 * `viewCameraNode` in camera3d.ts, beside the active-camera rule it falls back
 * to.
 */

import type { OrthoView } from '@motion/scene';

/** A view that looks through ONE named camera node rather than the topmost. */
export type CameraViewMode = `camera:${string}`;

const PREFIX = 'camera:';

/** The view mode that looks through `nodeId`. */
export function cameraViewMode(nodeId: string): CameraViewMode {
  return `${PREFIX}${nodeId}`;
}

export function isCameraViewMode(mode: string | null | undefined): mode is CameraViewMode {
  // A bare "camera:" names nothing; treating it as a camera view would only
  // ever resolve through the fallback, so it is simply not one.
  return typeof mode === 'string' && mode.length > PREFIX.length && mode.startsWith(PREFIX);
}

/** The node id a camera view names, or null for every other mode. */
export function cameraViewNodeId(mode: string | null | undefined): string | null {
  return isCameraViewMode(mode) ? mode.slice(PREFIX.length) : null;
}

/**
 * True when a view renders THROUGH A SCENE CAMERA: perspective, depth of field,
 * camera motion blur, the comp-rect clip — the shot, not an inspection view.
 *
 * 'active' used to be the only such mode, so "is this the shot?" was spelled
 * `mode === 'active'` all over the chrome. A camera view is the same kind of
 * view through a different node, and every one of those checks has to accept
 * it; one predicate is what stops the next camera-ish mode from being missed at
 * half of them.
 */
export function isSceneCameraView(mode: string): mode is 'active' | CameraViewMode {
  return mode === 'active' || isCameraViewMode(mode);
}

const ORTHO_VIEWS: readonly OrthoView[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];

/**
 * The axis view a mode projects with, or null for a perspective view.
 *
 * A WHITELIST, not "anything that is not active or custom": that negative test
 * is how every consumer used to find the ortho view, and it would have cast
 * `camera:<id>` to an `OrthoView` and handed it to `projectOrtho`. Anything
 * unrecognised now projects in perspective through the active camera, which
 * is also where a stale camera view lands — never a blank or garbage frame.
 */
export function orthoViewOf(mode: string | null | undefined): OrthoView | null {
  return typeof mode === 'string' && (ORTHO_VIEWS as readonly string[]).includes(mode)
    ? (mode as OrthoView)
    : null;
}
