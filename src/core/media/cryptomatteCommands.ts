/**
 * "ID matte from Cryptomatte" — the command behind the Track Matte picker's
 * "ID matte: <object>" entries (plan C2).
 *
 * Bakes the chosen objects' coverage to a grey PNG, adds it to the project as
 * an asset, inserts it as a layer directly above the EXR layer and sets it as
 * that layer's LUMA matte. Nothing new in the compositor: an ID matte is a
 * matte layer like any other, so it keys, animates, blurs and exports through
 * the machinery track mattes already have.
 */

import { useAssetStore } from '@stores/assetStore';
import { useSelectionStore } from '@stores/selectionStore';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { bumpScene } from '@stores/sceneStore';
import { setNodeMatte } from '@core/effects/matte';
import { insertMedia } from '@core/scene/sceneInsert';
import { reorderNode } from '@core/scene/parenting';
import { coverageToRgba8, getCryptomatteForAsset, idMatteCoverage, type CryptomatteSet } from './cryptomatte';

/** The EXR asset a layer draws, if it carries a Cryptomatte set. */
export function cryptomatteForNode(nodeId: string): { assetId: string; set: CryptomatteSet } | null {
  const node = defaultSceneGraph.getNode(nodeId);
  const t = node?.components.find((c) => c.type === 'Transform');
  const assetId = t?.props.assetId;
  if (typeof assetId !== 'string' || !assetId) return null;
  const set = getCryptomatteForAsset(assetId);
  return set ? { assetId, set } : null;
}

/** Bake coverage to a PNG File named after the objects it isolates. */
export async function idMattePngFile(set: CryptomatteSet, layerName: string, objectNames: ReadonlyArray<string>, baseName: string): Promise<File | null> {
  const layer = set.layers.find((l) => l.name === layerName);
  if (!layer) return null;
  const hashes = layer.objects.filter((o) => objectNames.includes(o.name)).map((o) => o.hash);
  if (hashes.length === 0) return null;
  const coverage = idMatteCoverage(set, layer, hashes);
  const canvas = document.createElement('canvas');
  canvas.width = set.width; canvas.height = set.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(new ImageData(coverageToRgba8(coverage), set.width, set.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return null;
  const label = objectNames.length === 1 ? objectNames[0]! : `${objectNames.length} objects`;
  return new File([blob], `${baseName} — ID matte (${label}).png`, { type: 'image/png' });
}

/**
 * Create the matte layer for `nodeId` from its EXR's Cryptomatte and wire it
 * as the luma matte. Resolves to the new layer's id, or null when the layer
 * has no set / the objects are unknown.
 */
export async function createIdMatteLayer(nodeId: string, layerName: string, objectNames: ReadonlyArray<string>): Promise<string | null> {
  const found = cryptomatteForNode(nodeId);
  if (!found) return null;
  const node = defaultSceneGraph.getNode(nodeId);
  const file = await idMattePngFile(found.set, layerName, objectNames, node?.name ?? 'EXR');
  if (!file) return null;
  const asset = await useAssetStore.getState().addAsset(file);
  const matteId = await insertMedia(asset);
  if (!matteId) return null;
  // Directly above the EXR layer (stack order: the next index up), so "Layer
  // Above" would also find it — the explicit source id is kept so a later
  // reorder cannot detach it.
  const parentId = node?.parent ?? null;
  if (parentId) {
    const at = defaultSceneGraph.getChildOrder(parentId).indexOf(nodeId);
    if (at >= 0) reorderNode(matteId, at + 1);
  }
  setNodeMatte(nodeId, { mode: 'luma', inverted: false, sourceId: matteId });
  useSelectionStore.getState().set([nodeId]);
  bumpScene();
  return matteId;
}
