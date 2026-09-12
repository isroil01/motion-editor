/**
 * What double-clicking a layer opens — After Effects' rules.
 *
 *   • A COMPOSITION layer opens the composition it shows, or — with the
 *     preference "On Comp Layer Opens: Layer panel" — the Layer panel.
 *     Alt+double-click always does the other one.
 *   • A FOOTAGE layer (video, image, vector, solid) opens the Layer panel, or —
 *     with "On Footage Layer Opens: Source" — its footage in the Footage viewer.
 *     With a paint or Roto tool active it is always the Layer panel, which is
 *     where AE does that work.
 *   • A GROUP (not an AE concept) opens as its own tab, as before.
 *   • Text and shape layers open nothing here: AE has no Layer panel for them
 *     (they are continuously rasterized), and the canvas edits text itself.
 *
 * Returns false when nothing opened, so callers keep their own fallback.
 */

import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { readNodeKind } from '@core/scene/sceneDerive';
import { readCompRef } from '@core/scene/compInstance';
import { openLayerComposition } from '@core/composition/compNavigation';
import { assetIdOf } from '@core/source/sourceInfo';
import { useLayerViewerStore } from '@stores/layerViewerStore';
import { usePreferenceStore } from '@stores/preferenceStore';
import { useUIStore } from '@stores/uiStore';
import { useAssetStore } from '@stores/assetStore';
import { openFootagePreview } from '@layout/Assets/FootagePreviewDialog';
import type { SceneNode } from '@core/types';

/** Tools whose double-click always means "open the Layer panel" in AE. */
const LAYER_PANEL_TOOLS: ReadonlySet<string> = new Set(['brush', 'paint', 'eraser', 'roto']);

/** Can this layer be shown in the Layer panel? (AE: footage, solids, comps.) */
export function canOpenInLayerPanel(node: SceneNode | undefined): boolean {
  if (!node) return false;
  if (readCompRef(node)) return true;
  const kind = readNodeKind(node);
  if (kind === 'image' || kind === 'video' || kind === 'svg') return true;
  if (kind === 'shape') {
    const fx = node.components.find((c) => c.type === 'fx')?.props as Record<string, unknown> | undefined;
    return fx?.solid === true;
  }
  return false;
}

/** Show `nodeId` in the Layer panel. False for a layer it cannot show. */
export function openLayerPanel(nodeId: string): boolean {
  if (!canOpenInLayerPanel(defaultSceneGraph.getNode(nodeId))) return false;
  useLayerViewerStore.getState().open(nodeId);
  return true;
}

/** AE's double-click on a layer (canvas or timeline). */
export function openLayerOnDoubleClick(nodeId: string, opts: { alt?: boolean } = {}): boolean {
  const node = defaultSceneGraph.getNode(nodeId);
  if (!node) return false;
  const alt = opts.alt === true;
  const prefs = usePreferenceStore.getState();

  if (readCompRef(node)) {
    const wantPanel = (prefs.compLayerOpens === 'layer') !== alt;
    return wantPanel
      ? openLayerPanel(nodeId) || openLayerComposition(nodeId)
      : openLayerComposition(nodeId) || openLayerPanel(nodeId);
  }
  if (readNodeKind(node) === 'group') return openLayerComposition(nodeId);
  if (!canOpenInLayerPanel(node)) return false;

  const paintTool = LAYER_PANEL_TOOLS.has(useUIStore.getState().activeTool);
  const wantSource = !paintTool && ((prefs.footageLayerOpens === 'source') !== alt);
  if (wantSource) {
    const assetId = assetIdOf(node);
    const asset = assetId ? useAssetStore.getState().assets.find((a) => a.id === assetId) : undefined;
    if (asset) {
      openFootagePreview(asset);
      return true;
    }
    // A solid has no footage to show — the Layer panel is all there is.
  }
  return openLayerPanel(nodeId);
}
