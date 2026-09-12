/**
 * The track-header column's rows: a layer's header (name, switches, modes,
 * parent), a property sub-row's header (name, value fields, keyframe
 * navigator) and a category accordion heading. Split out of `Timeline.tsx`.
 */

import { memo, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '@utils/cn';
import { Icon, type IconName } from '@components/Icon';
import { StopwatchButton, KeyframeNavigator } from '@components/PropertyRow';
import { PickWhip } from '@components/PickWhip';
import { ValueField } from '@components/ValueField';
import type { TimelineTrack, TimelineKeyframeRef } from './TimelineModel';
import { Dropdown } from '@components/Dropdown';
import { type LayerBlendMode } from '@core/effects/blendMode';
import { blendDropdownItems, blendModeLabel } from '@layout/Inspector/blendMenu';
import { eligibleParents, parentOfNode, parentOptionsFor } from '@core/scene/parenting';
import type { MenuSelectModifiers } from '@components/Menu';
import { extraColumnValue, type TimelineExtraColumn } from './timelineColumns';
import styles from './Timeline.module.css';
import { ColorPicker } from '@components/ColorPicker';
import { MATTE_OPTIONS, MATTE_SHORT_LABEL, matteOptionId, applyMatteOption } from '@components/MatteControl/matteMenu';
import { areRowPropsEqual } from './rowMemo';

// Label colours come from the ONE palette in `core/scene/labelColor`. This file
// used to carry its own 12 hexes, so the same layer showed a different red in the
// timeline than in the scene tree and the canvas menu — three palettes for one
// property. (A fourth lived in the since-removed Motion Tools panel, which also
// wrote `node.color` directly instead of through `setNodeLabelColor`, so its
// choice never even saved.)

/*
  `data-whip-layer` on the row makes it a pick-whip drop target. `track.id` IS
  the scene node id — `deriveTimelineTracks` builds one track per node — so no
  lookup is needed on the drop side. See `@core/whip/whipTarget`.
*/
export const TrackHeader = memo(function TrackHeader({
  track,
  index,
  selected,
  expanded,
  hasProps,
  onToggleExpand,
  onActivate,
  onClick,
  onToggleVisible,
  onToggleLock,
  onToggleSolo,
  onToggleAudio,
  onBlendModeChange,
  onMatteChange,
  onParentChange,
  onToggleFlag,
  onRename,
  onTrackColorChange,
  switchesOnHover = false,
  switchesPinned = false,
  onToggleSwitchPin,
  showSwitches = true,
  showModes = true,
  extraColumns,
  frameRate,
  active,
  onRowFocus,
  onReorderStart,
  style,
}: {
  track: TimelineTrack;
  index: number;
  selected: boolean;
  expanded: boolean;
  hasProps: boolean;
  /** In / Out / Duration, in the order the user turned them on. */
  extraColumns: ReadonlyArray<TimelineExtraColumn>;
  frameRate: number;
  /** The list's single tab stop — see the roving tabindex on the row. */
  active: boolean;
  onRowFocus: () => void;
  /** `recursive` is Alt+click: the layer and everything under it. */
  onToggleExpand: (recursive: boolean) => void;
  onActivate: () => void;
  onClick: (additive: boolean) => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
  /** `exclusive` is Alt+click: AE's "turn off all other solo switches". */
  onToggleSolo: (exclusive: boolean) => void;
  /** Toggle this layer's AUDIO. Absent = no speaker switch. */
  onToggleAudio?: () => void;
  onBlendModeChange?: (mode: LayerBlendMode) => void;
  onMatteChange?: (matte: any) => void;
  /** `options.preserveWorld: false` is the Alt variant — link without compensating. */
  onParentChange?: (parentId: string | null, options?: { preserveWorld?: boolean }) => void;
  onToggleFlag?: (flag: 'shy' | 'collapse' | 'fxEnabled' | 'motionBlur' | 'adjustment' | 'threeD' | 'guide' | 'preserveTransparency') => void;
  onRename?: (newName: string) => void;
  onTrackColorChange?: (trackId: string, color: string) => void;
  /** Keep the seven AE switches quiet until the row is hovered. */
  switchesOnHover?: boolean;
  /** This row has pinned them open through its own control. */
  switchesPinned?: boolean;
  onToggleSwitchPin?: () => void;
  /** AE's Toggle Switches / Modes — see `TimelineProps['columns']`. */
  showSwitches?: boolean;
  showModes?: boolean;
  onReorderStart?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  style: CSSProperties;
}): JSX.Element {
  const hidden = track.muted === true;
  const locked = track.locked === true;
  const solo = track.solo === true;
  const audioMuted = track.audioMuted === true;

  /**
   * The LAYER's span, for the In / Out / Duration columns: first clip start to
   * last clip end. Not "the first clip" — a layer that was split has several
   * bars, and its in-point is the head of the first one, not of whichever
   * happens to be at index 0 after a reorder.
   */
  const layerSpan = useMemo(() => {
    const clips = track.clips ?? [];
    if (clips.length === 0) return undefined;
    let min = Infinity;
    let max = -Infinity;
    for (const c of clips) {
      min = Math.min(min, c.start);
      max = Math.max(max, c.start + c.duration);
    }
    return Number.isFinite(min) ? { start: min, duration: max - min } : undefined;
  }, [track.clips]);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(track.name);
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = (e: React.MouseEvent): void => {
    e.stopPropagation();
    setDraft(track.name);
    setEditing(true);
    setTimeout(() => { inputRef.current?.select(); }, 10);
  };
  const commitRename = (): void => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== track.name) onRename?.(trimmed);
  };

  const currentParent = parentOfNode(track.id);
  const parentOptions = eligibleParents(track.id);
  const currentParentName = currentParent
    ? parentOptions.find((o) => o.id === currentParent)?.name ?? 'Parent'
    : 'None';

  // Option id + label come from the SHARED menu, not a second hardcoded copy of
  // the four labels. This row and the inspector used to each own their own list.
  const currentMatteOption = matteOptionId(track.matteMode);
  const currentMatteLabel = MATTE_SHORT_LABEL[currentMatteOption] ?? 'None';

  const parentItems = [
    {
      type: 'item' as const,
      id: '__none__',
      label: 'None',
      icon: currentParent === null ? ('check' as const) : undefined,
      onSelect: (m: MenuSelectModifiers) => onParentChange?.(null, parentOptionsFor(m)),
    },
    ...(parentOptions.length ? [{ type: 'separator' as const }] : []),
    ...parentOptions.map((o) => ({
      type: 'item' as const,
      id: o.id,
      label: o.name,
      icon: o.id === currentParent ? ('check' as const) : undefined,
      onSelect: (m: MenuSelectModifiers) => onParentChange?.(o.id, parentOptionsFor(m)),
    })),
  ];

  return (
    <div
      className={cn(styles.trackHeader, selected && styles.trackHeaderSelected)}
      style={{ ...style, '--track-color': track.color ?? 'transparent' } as CSSProperties}
      data-track-id={track.id}
      data-whip-layer={track.id}
      data-hidden={hidden || undefined}
      data-ghost={track.ghosted || undefined}
      data-locked={locked || undefined}
      onClick={(e) => onClick(e.ctrlKey || e.metaKey || e.shiftKey)}
      onDoubleClick={onActivate}
      onFocus={onRowFocus}
      onKeyDown={(e) => {
        // Enter, Space and the arrows belong to the LISTBOX, which handles
        // them one level up; F2 is the row's own.
        if (e.key === 'F2') {
          e.preventDefault();
          onActivate();
        }
      }}
      role="option"
      /* Roving: one tab stop for the whole list, the arrows move within it.
         Every row being `tabIndex={0}` made Tab the only way down the list. */
      tabIndex={active ? 0 : -1}
      aria-selected={selected}
      aria-label={track.name}
      title="↑ ↓ to move · Enter to expand · Space to hide · F2 to focus"
    >
      <div className={styles.preInfoCol}>
        <button
          type="button"
          className={styles.trackAction}
          data-kind="visible"
          data-on={!hidden || undefined}
          aria-label={hidden ? 'Show track' : 'Hide track'}
          title={hidden ? 'Hide' : 'Show (Video)'}
          onClick={(e) => { e.stopPropagation(); onToggleVisible(); }}
        >
          <Icon name={hidden ? 'eye-off' : 'eye'} size="sm" />
        </button>
        {/* AE's A/V Features column puts the speaker next to the eye. The clip
            bar has the same glyph; both write the one prop, so a layer scrolled
            past its bar still has a reachable audio switch. Layers that make no
            sound get a spacer instead, so the column stays aligned. */}
        {track.hasAudio && onToggleAudio ? (
          <button
            type="button"
            className={styles.trackAction}
            data-kind="audio"
            data-on={!audioMuted || undefined}
            aria-label={audioMuted ? 'Unmute layer audio' : 'Mute layer audio'}
            aria-pressed={audioMuted}
            title={audioMuted ? 'Unmute audio' : 'Mute audio'}
            onClick={(e) => { e.stopPropagation(); onToggleAudio(); }}
          >
            <Icon name={audioMuted ? 'audio-off' : 'audio'} size="sm" />
          </button>
        ) : (
          <span className={styles.trackAction} data-kind="audio" data-spacer="" aria-hidden="true" />
        )}
        <button
          type="button"
          className={styles.trackAction}
          data-kind="solo"
          data-on={solo || undefined}
          aria-label={solo ? 'Unsolo track' : 'Solo track'}
          title={solo ? 'Unsolo' : 'Alt-click to solo only this layer'}
          onClick={(e) => { e.stopPropagation(); onToggleSolo(e.altKey); }}
        >
          <Icon name="circle" size="sm" />
        </button>
        <button
          type="button"
          className={styles.trackAction}
          data-kind="lock"
          data-on={locked || undefined}
          aria-label={locked ? 'Unlock track' : 'Lock track'}
          title={locked ? 'Unlock' : 'Lock'}
          onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
        >
          <Icon name="lock" size="sm" />
        </button>
      </div>

      <div className={styles.layerInfoCol} style={{ paddingLeft: track.depth ? track.depth * 14 : undefined }}>
        <div
          className={styles.dragHandle}
          title="Drag to reorder"
          onPointerDown={onReorderStart}
        >
          <Icon name="grip-vertical" size="sm" />
        </div>
        <span className={styles.trackIndex}>{index}</span>
        {typeof track.nodeColor === 'string' && (
          <div onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <ColorPicker
              value={track.nodeColor || '#5282b8'}
              onChange={(hex) => onTrackColorChange?.(track.id, hex)}
              compact
              alpha={false}
              aria-label="Layer label color"
            />
          </div>
        )}
        <button
          type="button"
          className={cn(styles.disclosure, !hasProps && styles.disclosureHidden)}
          aria-label={expanded ? 'Collapse properties' : 'Reveal animated properties'}
          aria-expanded={expanded}
          title={
            expanded
              ? 'Collapse (Alt+click: this layer and everything under it)'
              : 'Reveal animated properties (U) — Alt+click for this layer and everything under it'
          }
          onClick={(e) => {
            e.stopPropagation();
            if (hasProps) onToggleExpand(e.altKey);
          }}
        >
          <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size="sm" />
        </button>
        <span
          className={styles.trackIcon}
          style={{ color: track.color ?? 'var(--color-accent)' }}
          title={track.kind}
        >
          <Icon name={(track.icon as IconName) ?? 'layers'} size="sm" />
        </span>
        {editing ? (
          <input
            ref={inputRef}
            className={styles.trackNameInput}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
            }}
            onClick={(e) => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <span
            className={styles.trackName}
            title={`${track.name} — double-click to rename`}
            onDoubleClick={startRename}
          >
            {track.name}
          </span>
        )}
      </div>

      {showSwitches && (
        <div
          className={styles.aeSwitchesCol}
          // An ATTRIBUTE, not a class, so the stylesheet can key both the
          // resting state and the row's own `:hover` off one selector. A class
          // would need this component to re-render on hover, which is exactly
          // the per-row work `areRowPropsEqual` exists to avoid.
          data-quiet={switchesOnHover && !switchesPinned ? '' : undefined}
        >
          <button
            type="button"
            className={styles.trackAction}
            data-kind="shy"
            data-on={(track as any).shy || undefined}
            title="Toggle Shy Layer"
            onClick={(e) => { e.stopPropagation(); onToggleFlag?.('shy'); }}
          >
            <Icon name="shy" size="sm" />
          </button>

          <button
            type="button"
            className={styles.trackAction}
            data-kind="fx"
            data-on={track.fxEnabled !== false || undefined}
            title="Toggle Effects (fx)"
            onClick={(e) => { e.stopPropagation(); onToggleFlag?.('fxEnabled'); }}
          >
            <span className={styles.fxText}>fx</span>
          </button>

          <button
            type="button"
            className={styles.trackAction}
            data-kind="motionBlur"
            data-on={track.motionBlur || undefined}
            title="Toggle Motion Blur"
            onClick={(e) => { e.stopPropagation(); onToggleFlag?.('motionBlur'); }}
          >
            <Icon name="motion-blur" size="sm" />
          </button>
          <button
            type="button"
            className={styles.trackAction}
            data-kind="adjustment"
            data-on={track.adjustment || undefined}
            title="Toggle Adjustment Layer"
            onClick={(e) => { e.stopPropagation(); onToggleFlag?.('adjustment'); }}
          >
            <Icon name="adjustment" size="sm" />
          </button>
          <button
            type="button"
            className={styles.trackAction}
            data-kind="guide"
            data-on={track.guide || undefined}
            aria-pressed={track.guide === true}
            title={track.guide ? 'Guide layer — not rendered on export' : 'Make Guide Layer'}
            onClick={(e) => { e.stopPropagation(); onToggleFlag?.('guide'); }}
          >
            {/* NOT `eye-off`. That is the glyph the VISIBILITY switch shows when
                a layer is hidden, so every row carried two eyes doing unrelated
                jobs — visibility over in the pre-info column, guide-layer here —
                and the pair read as one control duplicated. A guide layer is
                reference framing the render skips, which is what `frame` says. */}
            <Icon name="frame" size="sm" />
          </button>
          {/* Preserve Underlying Transparency — AE's "T" switch. A glyph rather
              than an icon because that is what it is called and what AE draws;
              the column legend carries the same T in the same position. */}
          <button
            type="button"
            className={styles.trackAction}
            data-kind="preserveTransparency"
            data-on={track.preserveTransparency || undefined}
            aria-pressed={track.preserveTransparency === true}
            aria-label="Preserve Underlying Transparency"
            title={track.preserveTransparency
              ? 'Preserve Underlying Transparency — visible only where layers beneath are opaque'
              : 'Preserve Underlying Transparency'}
            onClick={(e) => { e.stopPropagation(); onToggleFlag?.('preserveTransparency'); }}
          >
            <span className={styles.fxText}>T</span>
          </button>
          <button
            type="button"
            className={styles.trackAction}
            data-kind="threeD"
            data-on={track.threeD || undefined}
            title="Toggle 3D Layer"
            onClick={(e) => { e.stopPropagation(); onToggleFlag?.('threeD'); }}
          >
            <Icon name="3d" size="sm" />
          </button>

          {/* The per-row pin. Shown on hover like the switches themselves
              unless the row has pinned them, in which case it has to stay
              visible — it is the only way back. */}
          {onToggleSwitchPin && switchesOnHover && (
            <button
              type="button"
              className={styles.switchPin}
              data-on={switchesPinned || undefined}
              aria-pressed={switchesPinned}
              aria-label={switchesPinned ? 'Unpin layer switches' : 'Pin layer switches'}
              title={switchesPinned
                ? 'Switches pinned open for this layer — click to let them hide again'
                : 'Keep this layer’s switches visible'}
              onClick={(e) => { e.stopPropagation(); onToggleSwitchPin(); }}
            >
              <Icon name="more-horizontal" size="sm" />
            </button>
          )}
        </div>
      )}

      {showModes && (
        <>
        <div className={styles.modeCol} onClick={(e) => e.stopPropagation()}>
          <Dropdown
            placement="bottom-start"
            trigger={
              <button type="button" className={styles.timelineSelectTrigger} aria-label="Layer Blend Mode">
                {blendModeLabel(track.blendMode as LayerBlendMode | undefined)}
              </button>
            }
            items={blendDropdownItems(
              track.blendMode as LayerBlendMode | undefined,
              (m) => onBlendModeChange?.(m),
            )}
          />
        </div>

        <div className={styles.matteCol} onClick={(e) => e.stopPropagation()}>
          <Dropdown
            placement="bottom-start"
            trigger={
              <button type="button" className={styles.timelineSelectTrigger} aria-label="Track Matte">
                {currentMatteLabel}
              </button>
            }
            items={MATTE_OPTIONS.map((m) => ({
              type: 'item',
              id: m.id,
              label: MATTE_SHORT_LABEL[m.id] ?? m.label,
              icon: m.id === currentMatteOption ? ('check' as const) : undefined,
              onSelect: () => onMatteChange?.(applyMatteOption(track.matteMode, m.id)),
            }))}
          />
        </div>

        {/*
          "Parent & Link" — the column's name, and now both halves of it. The
          whip is the gesture; the dropdown is for a parent that is scrolled out
          of sight. Both call `onParentChange`, so parenting cannot mean two
          different things depending on which control was used.
        */}
        <div className={styles.parentCol} onClick={(e) => e.stopPropagation()}>
          <PickWhip
            label="Parent pick-whip — drag onto a layer (Alt: keep values, layer jumps)"
            accept={(target) => parentOptions.some((o) => o.id === target.nodeId)}
            onPick={(target, m) => onParentChange?.(target.nodeId, parentOptionsFor(m))}
          />
          <Dropdown
            placement="bottom-start"
            trigger={
              <button type="button" className={styles.timelineSelectTrigger} aria-label="Parent Layer">
                {currentParentName}
              </button>
            }
            items={parentItems}
          />
        </div>
        </>
      )}

      {/*
        In / Out / Duration — AE's optional columns, off by default.

        Read-outs, not fields: the numbers answer "where does this layer sit"
        at a glance, which is the question the columns exist for, and the edit
        that would follow (trimming a head to a typed frame) already has a
        gesture on the bar itself. Shipping them as inputs whose commit path is
        not wired would be worse than shipping them as the readout they are —
        see the report for what a writable column needs.
      */}
      {extraColumns.map((id) => {
        const value = extraColumnValue(id, layerSpan, frameRate, 100);
        return (
          <div key={id} className={styles.extraCol} data-col={id} title={`${id === 'in' ? 'In' : id === 'out' ? 'Out' : 'Duration'} (frames)`}>
            {value === null ? '—' : value}
          </div>
        );
      })}
    </div>
  );
}, areRowPropsEqual);

/** Times within this many seconds of the playhead count as "at" it. */
export const KEYFRAME_EPSILON = 1e-4;

/**
 * A property sub-row: its name plus AE's keyframe navigator — `◀ ◆ ▶`. The
 * diamond is filled when a keyframe sits at the playhead and hollow otherwise;
 * clicking it adds or removes one *without changing the value*, which is the
 * only way to anchor a property before animating it away.
 */
/**
 * One property row in the timeline's track header column: the name, its live
 * value field(s), and either the keyframe navigator or a stopwatch.
 *
 * Exported so its behaviour can be tested directly — driving it through the
 * whole virtualized Timeline would test the scroller, not the row.
 */
export function PropertyHeader({
  label,
  style,
  keyframes,
  currentTime,
  animated = true,
  valueProps,
  valueUnit,
  propertyValue,
  onValueChange,
  onScrubStart,
  onScrubEnd,
  selected = false,
  onSelect,
  onToggleKeyframe,
  onStopwatch,
  onSeek,
  whipNodeId,
  whipProp,
}: {
  label: string;
  style: CSSProperties;
  keyframes: ReadonlyArray<TimelineKeyframeRef>;
  currentTime: number;
  /** False for a static placeholder row — shows the stopwatch instead of ◀◆▶. */
  animated?: boolean;
  /** Engine props this row edits — one value field each (Position → x, y). */
  valueProps?: ReadonlyArray<string>;
  valueUnit?: string;
  propertyValue?: (prop: string) => number;
  onValueChange?: (prop: string, value: number) => void;
  onScrubStart?: (prop: string) => void;
  onScrubEnd?: () => void;
  /** This row is in the property selection (highlighted name). */
  selected?: boolean;
  onSelect?: (mode: 'replace' | 'toggle') => void;
  onToggleKeyframe?: () => void;
  /** Enable animation for a static placeholder row (create first keyframe). */
  onStopwatch?: () => void;
  onSeek?: (time: number) => void;
  /** The layer and property this row edits, so a pick-whip can land on it. */
  whipNodeId?: string;
  whipProp?: string;
}): JSX.Element {
  const sorted = useMemo(() => [...keyframes].sort((a, b) => a.time - b.time), [keyframes]);
  const at = sorted.find((k) => Math.abs(k.time - currentTime) < KEYFRAME_EPSILON);
  const prev = [...sorted].reverse().find((k) => k.time < currentTime - KEYFRAME_EPSILON);
  const next = sorted.find((k) => k.time > currentTime + KEYFRAME_EPSILON);

  // AE puts a live, scrubbable value beside every property here, so a whole
  // animation can be built without leaving the timeline.
  const fields =
    valueProps && valueProps.length > 0 && propertyValue && onValueChange ? (
      <div className={styles.propValues}>
        {valueProps.map((p) => (
          <ValueField
            key={p}
            value={propertyValue(p)}
            unit={valueUnit}
            onChange={(v) => onValueChange(p, v)}
            onScrubStart={onScrubStart ? () => onScrubStart(p) : undefined}
            onScrubEnd={onScrubEnd}
            aria-label={valueProps.length > 1 ? `${label} ${p}` : label}
          />
        ))}
      </div>
    ) : null;

  /**
   * The stopwatch sits on EVERY property row, left of its name, lit when the
   * property is animated — that is where AE puts it and what it means there.
   *
   * It used to appear only on un-animated rows, so the timeline could turn
   * animation ON but never OFF: removing a property's animation meant crossing
   * to the inspector to find the same control.
   */
  // The SHARED stopwatch — the same component the inspector and the effect
  // stack render, so the control that turns animation on cannot look like a
  // checkbox in one panel and a stopwatch in another.
  const stopwatch = onStopwatch ? (
    <StopwatchButton animated={animated} label={label} onToggle={onStopwatch} />
  ) : null;

  // The name is the row's SELECT target — AE's property selection, on which
  // proportional scrubbing is defined. Ctrl/Cmd-click adds to the ordered
  // selection; a plain click replaces it.
  const name = (
    <span
      className={cn(styles.propName, onSelect && styles.propNameSelectable, selected && styles.propNameSelected)}
      title={label}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      aria-pressed={onSelect ? selected : undefined}
      onClick={
        onSelect
          ? (e) => {
              e.stopPropagation();
              onSelect(e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
            }
          : undefined
      }
      onKeyDown={
        onSelect
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
              }
            }
          : undefined
      }
    >
      {label}
    </span>
  );

  if (!animated) {
    // Static placeholder: the AE property tree before any keyframes exist.
    return (
      <div
        className={cn(styles.propHeader, styles.propHeaderStatic, selected && styles.propHeaderSelected)}
        style={style}
        data-whip-layer={whipNodeId}
        data-whip-prop={whipProp}
      >
        {stopwatch}
        {name}
        {fields}
      </div>
    );
  }

  return (
    <div
      className={cn(styles.propHeader, selected && styles.propHeaderSelected)}
      style={style}
      data-whip-layer={whipNodeId}
      data-whip-prop={whipProp}
    >
      {stopwatch}
      {name}
      {fields}
      <div className={styles.propNav}>
        <KeyframeNavigator
          label={label}
          hasPrev={!!prev}
          hasNext={!!next}
          atKeyframe={!!at}
          onPrev={() => prev && onSeek?.(prev.time)}
          onNext={() => next && onSeek?.(next.time)}
          onToggleKeyframe={() => onToggleKeyframe?.()}
        />
      </div>
    </div>
  );
}

export function TrackCategoryHeader({
  label,
  icon,
  expanded,
  count,
  style,
  sticky,
  onToggle,
}: {
  label: string;
  icon: IconName;
  expanded: boolean;
  count: number;
  style: CSSProperties;
  /** The PINNED copy: opaque, and shadowed so it reads as sitting above. */
  sticky?: boolean;
  onToggle: () => void;
}): JSX.Element {
  return (
    <div
      className={cn(styles.categoryHeader, sticky && styles.categoryHeaderSticky)}
      style={style}
      onClick={onToggle}
    >
      <span className={styles.disclosure}>
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size="sm" />
      </span>
      <span className={styles.categoryIcon}>
        <Icon name={icon} size="sm" />
      </span>
      <span className={styles.categoryName}>{label}</span>
      <span className={styles.categoryBadge}>{count}</span>
    </div>
  );
}
