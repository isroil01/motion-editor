/**
 * The viewport's right-click menus, split out of `useWorkspace.ts`.
 *
 * Three menus and the four helpers they share:
 *
 *   `nodeContextMenuItems`    right-click ON a layer — the same actions the
 *                             scene tree's menu offers, minus Rename (the
 *                             tree's inline rename is local ScenePanel state)
 *   `videoContextMenuItems`   the footage submenu inside it: speed, frame
 *                             blending, time remap, Interpret Footage
 *   `canvasContextMenuItems`  right-click on EMPTY canvas — view + selection
 *   `labelColorCanvasMenuItems`  the label-colour swatch submenu
 *
 * ## Why this is its own module
 *
 * Every function here is a pure top-level builder: it takes a node id (or the
 * controller) and returns `ContextMenuItem[]`. None of it closes over the
 * hook's refs, the backend, or the render loop — which is exactly why it could
 * be lifted out of a 3.6k-line hook without threading state, and why it is the
 * first thing that should be. Behaviour is unchanged: this is a move, not a
 * rewrite, and `useWorkspace` imports the same three builders it used to
 * define.
 *
 * The menus read the LIVE clock (`playheadTime`), never the tab record — a
 * "split here" written against a 4Hz mirror lands on the wrong frame during
 * playback.
 */

import { mergeSelectedPaths, liveMergeSelectedPaths } from '@core/scene/mergePaths';
import { getRemappedTime } from '@core/timeline/TimelineController';
import { useProjectStore } from '@stores/projectStore';
import { getTime as getPlayheadTime } from '@stores/playbackClockStore';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { defaultAnimation } from '@motion/animation';
import { useGuidesStore } from '@stores/guidesStore';
import { useUIStore } from '@stores/uiStore';
import { useSelectionStore } from '@stores/selectionStore';
import { is3DEnabled, set3DEnabled, canBe3D } from '@core/scene/threeD';
import { type WorkspaceController } from '@core/workspace/WorkspaceController';
import { runAnimEdit } from '@core/animation/animationCommands';
import { type ContextMenuItem } from '@stores/contextMenuStore';
import { svgContextMenuItems } from '@layout/Inspector/svgLayerActions';
import { bumpScene } from '@stores/sceneStore';
import { readNodeKind } from '@core/scene/sceneDerive';
import { renameLayer } from '@core/scene/renameLayer';
import { getNodeLayerTime, updateNodeLayerTime, type FrameBlend } from '@core/scene/layerTime';
import { openInterpretFootage } from '@layout/Assets/InterpretFootageModal';
import { assetIdOf } from '@core/source/sourceInfo';
import { sourceDisplaySize } from '@core/tracking/trackerSource';
import { useTrackerStore } from '@stores/trackerStore';
import { useAssetStore } from '@stores/assetStore';
import {
  duplicateSelectedLayers,
  deleteSelectedLayers,
  toggleSelectedLocked,
  toggleSelectedSolo,
  toggleSelectedVisible,
  groupSelectedLayers,
  ungroupSelected,
  precomposeSelected,
} from '@core/scene/sceneInsert';
import { rigLogoForAnimation } from '@core/scene/rigLogo';
import { arrangeNodes } from '@core/scene/parenting';
import { LABEL_COLORS, readNodeLabelColor, setNodeLabelColor } from '@core/scene/labelColor';
import { customPrompt } from '@components/Modal/Dialogs';

/**
 * Right-click menu for a canvas node — the same actions as the scene-tree menu
 * (DemoPanels.openNodeMenu), minus Rename: the tree's inline rename is local
 * ScenePanel state and window.prompt is unavailable in Electron.
 */
/**
 * The playhead, in raw comp time — the live clock, not the tab record.
 *
 * Exported because the gesture handlers and the overlay painters still in
 * `useWorkspace.ts` need it too. It is not really context-menu code; when the
 * gesture split lands it should move there and this re-export should go.
 */
export function playheadTime(): number {
  return getPlayheadTime();
}

/** The active composition's pixel size — the space projections resolve in.
 *  Exported for the same reason as `playheadTime` above. */
export function compSize(): { w: number; h: number } {
  const s = useProjectStore.getState();
  const comp = s.comps[s.tabs[s.activeTabId ?? '']?.compositionId ?? 'comp_root'];
  return { w: comp?.width ?? 1920, h: comp?.height ?? 1080 };
}

/**
 * The value a property has right now (sampled keyframes → component prop →
 * type default) — what an added keyframe must capture so nothing jumps.
 */
function currentPropValue(id: string, prop: string): number {
  const t = getPlayheadTime();
  const layerT = getRemappedTime(id, t);
  const sampled = defaultAnimation.sample(id, prop, layerT);
  if (sampled !== undefined) return sampled;
  const node = defaultSceneGraph.getNode(id);
  if (node) {
    for (const c of node.components) {
      const v = (c.props as Record<string, unknown>)[prop];
      if (typeof v === 'number') return v;
    }
    if (prop === 'x') return node.transform.position.x;
    if (prop === 'y') return node.transform.position.y;
  }
  const DEFAULTS: Record<string, number> = { scaleX: 1, scaleY: 1, opacity: 100 };
  return DEFAULTS[prop] ?? 0;
}

/** Keyframe `props` at the playhead, capturing their current values. */
function addKeyframesAtPlayhead(id: string, label: string, props: readonly string[]): void {
  const t = getPlayheadTime();
  const layerT = getRemappedTime(id, t);
  runAnimEdit(`Add ${label} keyframe`, () => {
    for (const p of props) {
      defaultAnimation.setKeyframe(id, p, layerT, currentPropValue(id, p));
    }
  });
}

function labelColorCanvasMenuItems(targetId: string): ContextMenuItem[] {
  const sel = useSelectionStore.getState().ids;
  const ids: string[] = sel.includes(targetId) ? [...sel] : [targetId];
  const node = defaultSceneGraph.getNode(targetId);
  const current = node ? readNodeLabelColor(node) : undefined;
  return [
    {
      id: 'label-none',
      label: 'None (Default)',
      icon: current === undefined ? 'check' : undefined,
      onSelect: () => setNodeLabelColor(ids, undefined),
    },
    { id: 'label-sep', separator: true },
    ...LABEL_COLORS.map((c): ContextMenuItem => ({
      id: `label-${c.id}`,
      label: c.label,
      icon: current === c.color ? 'check' : undefined,
      onSelect: () => setNodeLabelColor(ids, c.color),
    })),
  ];
}

/**
 * The Video submenu — the footage verbs, gathered where the footage IS.
 *
 * Every one of these already existed, spread across the Effects panel's Time
 * controls, the Inspector's Track Motion section and the Assets panel's
 * right-click. Users reported reaching for them on the LAYER and finding
 * nothing; a right-click on the clip is where an editor's muscle memory goes.
 * The submenu routes to the same single implementations — nothing here is a
 * second copy of a behaviour.
 */
export function videoContextMenuItems(id: string): ContextMenuItem {
  const time = getNodeLayerTime(id);
  const playhead = getPlayheadTime();
  const speed = (label: string, stretch: number): ContextMenuItem => ({
    id: `spd-${stretch}`,
    label,
    icon: time.stretch === stretch ? 'check' : undefined,
    onSelect: () => updateNodeLayerTime(id, { stretch }),
  });
  const blend = (label: string, mode: FrameBlend): ContextMenuItem => ({
    id: `fb-${mode}`,
    label,
    icon: time.frameBlend === mode ? 'check' : undefined,
    onSelect: () => updateNodeLayerTime(id, { frameBlend: mode }),
  });
  return {
    id: 'video',
    label: 'Video',
    children: [
      // Speed is the USER's word; stretch is the model's (200% stretch = half
      // speed). The labels speak speed so nobody does the reciprocal in their
      // head mid-edit.
      { id: 'speed', label: 'Speed', children: [
        speed('25% (4× slower)', 400),
        speed('50% (2× slower)', 200),
        speed('100% (normal)', 100),
        speed('200% (2× faster)', 50),
        speed('400% (4× faster)', 25),
      ] },
      { id: 'reverse', label: time.reverse ? 'Un-reverse' : 'Reverse', onSelect: () => updateNodeLayerTime(id, { reverse: !time.reverse }) },
      {
        id: 'freeze',
        label: time.freeze ? 'Un-freeze Frame' : 'Freeze Frame at Playhead',
        onSelect: () => updateNodeLayerTime(id, time.freeze
          ? { freeze: false }
          : { freeze: true, freezeTime: playhead }),
      },
      { id: 'fb', label: 'Frame Blending', children: [
        blend('Off', 'none'),
        blend('Frame Mix', 'mix'),
        blend('Pixel Motion (smooth slow-mo)', 'pixelMotion'),
      ] },
      { id: 'sep-v1', separator: true },
      {
        id: 'stab',
        label: 'Stabilize (smooth)…',
        onSelect: () => {
          const src = sourceDisplaySize(id);
          useTrackerStore.getState().setMode('smooth', src?.width ?? 0, src?.height ?? 0);
          useUIStore.getState().notify({
            level: 'info',
            message: 'Smooth Stabilize armed — open Inspector ▸ Track Motion and press Track.',
            durationMs: 4000,
          });
        },
      },
      {
        id: 'track',
        label: 'Track Motion…',
        onSelect: () => {
          const src = sourceDisplaySize(id);
          useTrackerStore.getState().setMode('follow', src?.width ?? 0, src?.height ?? 0);
          useUIStore.getState().notify({
            level: 'info',
            message: 'Tracker armed — drag the point in the viewport, then Track in Inspector ▸ Track Motion.',
            durationMs: 4000,
          });
        },
      },
      { id: 'sep-v2', separator: true },
      {
        id: 'interpret',
        label: 'Interpret Footage…',
        onSelect: () => {
          const assetId = assetIdOf(defaultSceneGraph.getNode(id)!);
          const asset = assetId ? useAssetStore.getState().assets.find((a) => a.id === assetId) : undefined;
          if (asset) openInterpretFootage(asset);
          else useUIStore.getState().notify({ level: 'info', message: 'This layer has no importable source to interpret.', durationMs: 2600 });
        },
      },
    ],
  };
}

export function nodeContextMenuItems(id: string): ContextMenuItem[] {
  const node = defaultSceneGraph.getNode(id);
  const hidden = node?.visible === false;
  const locked = (node as { locked?: boolean } | undefined)?.locked === true;
  const solo = (node as { solo?: boolean } | undefined)?.solo === true;
  const isGroup = node ? readNodeKind(node) === 'group' : false;
  const isVideo = node ? readNodeKind(node) === 'video' : false;
  const renameNode = (): void => {
    const n = defaultSceneGraph.getNode(id);
    if (!n) return;
    void (async () => {
      const newName = await customPrompt('Rename Layer', 'Give this layer a new name.', n.name, {
        confirmLabel: 'Rename',
      });
      if (!newName?.trim()) return;
      // Re-read: the dialog is async now, so the node could have been deleted
      // while it was open. The old synchronous prompt could not have this gap.
      if (!defaultSceneGraph.getNode(id)) return;
      const result = renameLayer(id, newName);
      if (!result.ok) return;
      if (result.repaired.length > 0) {
        const count = result.repaired.length;
        useUIStore.getState().notify({
          level: 'info',
          message: `${count} expression${count === 1 ? '' : 's'} updated to follow the new name.`,
          durationMs: 4000,
        });
      }
      if (result.captured.length > 0 || result.nameAlreadyInUse) {
        useUIStore.getState().notify({
          level: 'warning',
          message: `Another layer already uses “${newName.trim()}”; review expressions that reference that name.`,
          durationMs: 8000,
        });
      }
    })();
  };
  return [
    { id: 'rename', label: 'Rename…', onSelect: renameNode },
    { id: 'duplicate', label: 'Duplicate', onSelect: () => duplicateSelectedLayers() },
    // One call for the whole selection — see `reorderSiblings` for what looping
    // over it did to a multi-selection. Same helper the Layer menu and the
    // Scene panel's context menu use.
    { id: 'arrange', label: 'Arrange', children: [
      { id: 'arr-front', label: 'Bring to Front', onSelect: () => { arrangeNodes(useSelectionStore.getState().ids, 'front'); } },
      { id: 'arr-forward', label: 'Bring Forward', onSelect: () => { arrangeNodes(useSelectionStore.getState().ids, 'forward'); } },
      { id: 'arr-backward', label: 'Send Backward', onSelect: () => { arrangeNodes(useSelectionStore.getState().ids, 'backward'); } },
      { id: 'arr-back', label: 'Send to Back', onSelect: () => { arrangeNodes(useSelectionStore.getState().ids, 'back'); } },
    ] },
    { id: 'sep0', separator: true },
    { id: 'kf', label: 'Add Keyframe', children: [
      { id: 'kf-pos', label: 'Position', onSelect: () => addKeyframesAtPlayhead(id, 'Position', ['x', 'y']) },
      { id: 'kf-scale', label: 'Scale', onSelect: () => addKeyframesAtPlayhead(id, 'Scale', ['scaleX', 'scaleY']) },
      { id: 'kf-rot', label: 'Rotation', onSelect: () => addKeyframesAtPlayhead(id, 'Rotation', ['rotation']) },
      { id: 'kf-op', label: 'Opacity', onSelect: () => addKeyframesAtPlayhead(id, 'Opacity', ['opacity']) },
      { id: 'kf-all', label: 'All Transform', onSelect: () => addKeyframesAtPlayhead(id, 'Transform', ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'opacity']) },
    ] },
    // Footage verbs on the footage itself — see videoContextMenuItems.
    ...(isVideo ? [videoContextMenuItems(id), { id: 'sep-vid', separator: true } as ContextMenuItem] : []),
    { id: 'sep1', separator: true },
    { id: 'toggle', label: hidden ? 'Show' : 'Hide', onSelect: toggleSelectedVisible },
    { id: 'lock', label: locked ? 'Unlock' : 'Lock', onSelect: () => toggleSelectedLocked() },
    { id: 'solo', label: solo ? 'Unsolo' : 'Solo', onSelect: () => toggleSelectedSolo() },
    {
      id: 'toggle-3d',
      label: node && is3DEnabled(node) ? 'Disable 3D Layer' : 'Enable 3D Layer',
      onSelect: () => {
        const ids = useSelectionStore.getState().ids;
        for (const nid of (ids.includes(id) ? ids : [id])) {
          const n = defaultSceneGraph.getNode(nid);
          if (n && canBe3D(n)) set3DEnabled(nid, !is3DEnabled(n));
        }
        bumpScene();
      },
    },
    { id: 'labelColor', label: 'Label Color', children: labelColorCanvasMenuItems(id) },
    { id: 'sep2', separator: true },
    { id: 'group', label: 'Group Selection', onSelect: () => groupSelectedLayers() },
    ...(isGroup ? [{ id: 'ungroup', label: 'Ungroup', onSelect: () => ungroupSelected() }] : []),
    { id: 'precompose', label: 'Pre-compose…', onSelect: () => precomposeSelected() },
    { id: 'rig-logo', label: 'Rig Logo for Animation', onSelect: () => { void rigLogoForAnimation(); } },
    ...svgContextMenuItems(id),
    ...(useSelectionStore.getState().ids.length >= 2
      ? [
          { id: 'sep_merge', separator: true },
          {
            id: 'merge-paths',
            label: 'Merge Paths',
            children: [
              { id: 'merge-live-union', label: 'Live Union (Add)', onSelect: () => liveMergeSelectedPaths('union') },
              { id: 'merge-live-subtract', label: 'Live Subtract', onSelect: () => liveMergeSelectedPaths('subtract') },
              { id: 'merge-live-intersect', label: 'Live Intersect', onSelect: () => liveMergeSelectedPaths('intersect') },
              { id: 'merge-live-exclude', label: 'Live Exclude (XOR)', onSelect: () => liveMergeSelectedPaths('exclude') },
              { id: 'merge-sep', label: '—', disabled: true },
              { id: 'merge-union', label: 'Bake Union', onSelect: () => mergeSelectedPaths('union') },
              { id: 'merge-subtract', label: 'Bake Subtract', onSelect: () => mergeSelectedPaths('subtract') },
              { id: 'merge-intersect', label: 'Bake Intersect', onSelect: () => mergeSelectedPaths('intersect') },
              { id: 'merge-exclude', label: 'Bake Exclude', onSelect: () => mergeSelectedPaths('exclude') },
            ],
          },
        ]
      : []),
    { id: 'sep3', separator: true },
    { id: 'delete', label: 'Delete', danger: true, onSelect: () => deleteSelectedLayers() },
  ];
}

/** Right-click menu for empty canvas — view/selection basics. */
export function canvasContextMenuItems(controller: WorkspaceController): ContextMenuItem[] {
  const guides = useGuidesStore.getState();
  const hasSelection = useSelectionStore.getState().ids.length > 0;
  return [
    { id: 'select-all', label: 'Select All', onSelect: () => controller.ws.selectAll() },
    { id: 'deselect', label: 'Deselect', disabled: !hasSelection, onSelect: () => controller.ws.clearSelection() },
    { id: 'sep1', separator: true },
    { id: 'fit', label: 'Fit Comp in View', onSelect: () => controller.fitComposition() },
    { id: 'sep2', separator: true },
    { id: 'grid', label: guides.grid ? 'Hide Grid' : 'Show Grid', onSelect: () => guides.toggleGrid() },
    { id: 'rulers', label: guides.rulers ? 'Hide Rulers' : 'Show Rulers', onSelect: () => guides.toggleRulers() },
  ];
}
