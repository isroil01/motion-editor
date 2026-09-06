/**
 * SelectionHeader — the sticky strip at the top of the Properties panel:
 * what is selected, and the switches you should not need the timeline for.
 *
 *   [kind] Layer name (double-click to rename)  [label ●] [👁 ○ 🔒 3D MB Adj] [search] [⋯]
 *
 * With several layers selected the name becomes "3 layers" with a kind
 * breakdown ("2 shapes, 1 text"), every switch reports all / none / mixed,
 * and a click applies to all of them — as one undo entry.
 */

import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '@components/Icon';
import { Dropdown, type DropdownItem } from '@components/Dropdown';
import { cn } from '@utils/cn';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { bumpScene } from '@stores/sceneStore';
import { batchHistory } from '@stores/historyStore';
import { readNodeKind } from '@core/scene/sceneDerive';
import { splitKind } from '@core/plugins/layerKindSchema';
import { renameLayer } from '@core/scene/renameLayer';
import { LABEL_COLORS, getNodeLabelColor, setNodeLabelColor } from '@core/scene/labelColor';
import { KIND_COLOR } from '@core/scene/sceneDerive';
import { canBe3D, is3DEnabled, set3DEnabled } from '@core/scene/threeD';
import { getNodeMotionBlur, setNodeMotionBlur } from '@core/effects/motionBlur';
import { getNodeAdjustment, setNodeAdjustment } from '@core/effects/adjustment';
import { enableLayerMotionBlurWithFeedback, disableLayerMotionBlur, setAdjustmentWithFeedback } from '@core/effects/layerSwitchFeedback';
import { useNodesRevision } from '@core/inspector/nodeRevision';
import { selectionKinds } from '@core/inspector/multiSelection';
import styles from './SelectionHeader.module.css';

const LAYER_KIND_LABEL: Record<string, string> = {
  shape: 'Shape', text: 'Text', image: 'Image', video: 'Video', group: 'Group', null: 'Null',
  camera: 'Camera', light: 'Light', audio: 'Audio', svg: 'SVG', particle: 'Particle',
};

const LAYER_KIND_ICON: Record<string, IconName> = {
  shape: 'shape', text: 'type', image: 'image', video: 'video', group: 'folder', null: 'info',
  camera: 'camera', light: 'light', audio: 'audio', svg: 'shape', particle: 'sparkles',
};

export function layerKindLabel(kind: string): string {
  const custom = splitKind(kind);
  if (custom) return custom.kindId;
  return LAYER_KIND_LABEL[kind] ?? kind;
}

function plural(label: string, n: number): string {
  return n === 1 ? label : `${label}s`;
}

type Tri = 'all' | 'none' | 'mixed';

function tri(nodeIds: ReadonlyArray<string>, read: (id: string) => boolean): Tri {
  let on = 0;
  let total = 0;
  for (const id of nodeIds) {
    if (!defaultSceneGraph.getNode(id)) continue;
    total += 1;
    if (read(id)) on += 1;
  }
  if (total === 0 || on === 0) return 'none';
  return on === total ? 'all' : 'mixed';
}

interface ToggleSpec {
  id: string;
  icon: IconName;
  label: string;
  applies: (id: string) => boolean;
  read: (id: string) => boolean;
  write: (id: string, on: boolean) => void;
}

const TOGGLES: ReadonlyArray<ToggleSpec> = [
  {
    id: 'visible', icon: 'eye', label: 'Visible',
    applies: () => true,
    read: (id) => defaultSceneGraph.getNode(id)?.visible !== false,
    write: (id, on) => { const n = defaultSceneGraph.getNode(id); if (n) n.visible = on; },
  },
  {
    id: 'solo', icon: 'circle', label: 'Solo',
    applies: () => true,
    read: (id) => defaultSceneGraph.getNode(id)?.solo === true,
    write: (id, on) => { const n = defaultSceneGraph.getNode(id); if (n) n.solo = on; },
  },
  {
    id: 'locked', icon: 'lock', label: 'Lock',
    applies: () => true,
    read: (id) => defaultSceneGraph.getNode(id)?.locked === true,
    write: (id, on) => { const n = defaultSceneGraph.getNode(id); if (n) n.locked = on; },
  },
  {
    id: '3d', icon: '3d', label: '3D layer',
    applies: (id) => { const n = defaultSceneGraph.getNode(id); return !!n && canBe3D(n); },
    read: (id) => { const n = defaultSceneGraph.getNode(id); return !!n && is3DEnabled(n); },
    write: (id, on) => set3DEnabled(id, on),
  },
  {
    id: 'motionBlur', icon: 'motion-blur', label: 'Motion blur',
    applies: (id) => { const n = defaultSceneGraph.getNode(id); return !!n && readNodeKind(n) !== 'camera' && readNodeKind(n) !== 'light' && readNodeKind(n) !== 'audio'; },
    read: (id) => getNodeMotionBlur(id),
    write: (id, on) => { if (on) enableLayerMotionBlurWithFeedback(id, setNodeMotionBlur); else disableLayerMotionBlur(id, setNodeMotionBlur); },
  },
  {
    id: 'adjustment', icon: 'adjustment', label: 'Adjustment layer',
    applies: (id) => { const n = defaultSceneGraph.getNode(id); return !!n && readNodeKind(n) !== 'camera' && readNodeKind(n) !== 'light' && readNodeKind(n) !== 'audio'; },
    read: (id) => getNodeAdjustment(id),
    write: (id, on) => setAdjustmentWithFeedback(id, on, setNodeAdjustment),
  },
];

export interface SelectionHeaderProps {
  nodeIds: ReadonlyArray<string>;
  /** Right-hand controls owned by the panel (search, ⋯). */
  actions?: ReactNode;
}

function SelectionHeaderInner({ nodeIds = [], actions }: SelectionHeaderProps): JSX.Element | null {
  useNodesRevision(nodeIds);
  const primary = nodeIds[0] ?? null;
  const node = primary ? defaultSceneGraph.getNode(primary) : null;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  if (!primary || !node) return null;

  const kind = readNodeKind(node);
  const kindIcon = LAYER_KIND_ICON[kind] ?? 'layers';
  const multi = nodeIds.length > 1;
  const name = node.name?.trim() || primary;
  const kinds = selectionKinds(nodeIds);
  const breakdown = kinds.map((k) => `${k.count} ${plural(layerKindLabel(k.kind).toLowerCase(), k.count)}`).join(', ');
  const labelColor = getNodeLabelColor(primary) ?? KIND_COLOR[kind] ?? undefined;

  const commitRename = (): void => {
    setRenaming(false);
    const next = draft.trim();
    if (!next || next === name) return;
    renameLayer(primary, next);
  };

  const colorItems: DropdownItem[] = [
    {
      type: 'item', id: 'default', label: 'Default (by kind)',
      icon: getNodeLabelColor(primary) === undefined ? 'check' : undefined,
      onSelect: () => setNodeLabelColor(nodeIds, undefined),
    },
    { type: 'separator' },
    ...LABEL_COLORS.map((c): DropdownItem => ({
      type: 'item', id: c.id,
      label: (
        <span className={styles.colorItem}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill={c.color} /></svg>
          {c.label}
        </span>
      ),
      icon: getNodeLabelColor(primary) === c.color ? 'check' : undefined,
      onSelect: () => setNodeLabelColor(nodeIds, c.color),
    })),
  ];

  const applyToggle = (t: ToggleSpec): void => {
    const targets = nodeIds.filter((id) => t.applies(id));
    if (targets.length === 0) return;
    const state = tri(targets, t.read);
    const next = state !== 'all';
    batchHistory(`switch:${t.id}:${targets.join(',')}`, () => {
      for (const id of targets) t.write(id, next);
      bumpScene();
    });
  };

  return (
    <div className={styles.head} data-selection-header>
      <span className={styles.glyph} title={multi ? breakdown : layerKindLabel(kind)}>
        <Icon name={multi ? 'layers' : kindIcon} size="sm" />
      </span>

      {renaming && !multi ? (
        <input
          ref={inputRef}
          className={styles.nameInput}
          value={draft}
          aria-label="Layer name"
          autoFocus
          onChange={(e) => setDraft(e.currentTarget.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setRenaming(false);
          }}
        />
      ) : (
        <button
          type="button"
          className={styles.name}
          title={multi ? breakdown : `${name} — double-click to rename`}
          onDoubleClick={() => {
            if (multi) return;
            setDraft(name);
            setRenaming(true);
          }}
        >
          {multi ? `${nodeIds.length} layers` : name}
        </button>
      )}

      <span className={styles.kind}>{multi ? breakdown : layerKindLabel(kind)}</span>

      <Dropdown
        items={colorItems}
        placement="bottom-end"
        trigger={
          <button type="button" className={styles.swatchBtn} aria-label="Label colour" title="Label colour">
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <circle cx="5" cy="5" r="5" fill={labelColor ?? 'currentColor'} />
            </svg>
          </button>
        }
      />

      <span className={styles.switches} role="group" aria-label="Layer switches">
        {TOGGLES.filter((t) => nodeIds.some((id) => t.applies(id))).map((t) => {
          const state = tri(nodeIds.filter((id) => t.applies(id)), t.read);
          return (
            <button
              key={t.id}
              type="button"
              className={cn(styles.switch, state === 'all' && styles.switchOn, state === 'mixed' && styles.switchMixed)}
              aria-pressed={state === 'mixed' ? 'mixed' : state === 'all'}
              aria-label={t.label}
              title={state === 'mixed' ? `${t.label} — mixed, click to turn on for all` : t.label}
              onClick={() => applyToggle(t)}
            >
              <Icon name={t.id === 'visible' && state === 'none' ? 'eye-off' : t.id === 'locked' && state === 'none' ? 'unlock' : t.icon} size="sm" />
            </button>
          );
        })}
      </span>

      {actions}
    </div>
  );
}


/*
 * Memoized: the Properties panel re-renders for its own reasons (a selection
 * change, a sub-tab switch, the sticky header) and hands every section the
 * same `nodeId` it had before. Without this boundary the section would rebuild
 * its whole subtree on each of those, undoing the per-node subscriptions the
 * rows inside it use to stay asleep. Pinned by `inspectorRenderScope.test.tsx`.
 */
export const SelectionHeader = memo(SelectionHeaderInner);

export default SelectionHeader;
