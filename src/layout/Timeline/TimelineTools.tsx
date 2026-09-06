/**
 * The timeline's EDIT TOOLS — a segmented row of five buttons that says which
 * NLE edit a drag on a clip performs.
 *
 * ## Why a visible row and not just the modifiers
 *
 * Slip (Alt-drag) and slide (Alt+Shift-drag) shipped and then sat unused,
 * because nothing anywhere said they existed: no button, no tooltip, no menu
 * row. The only discovery path was holding a modifier over a bar and noticing
 * the cursor. Roll had no gesture at all, and razor meant moving the playhead
 * first. Five lit buttons make the whole family visible at once and give each
 * one a place to advertise its shortcut.
 *
 * ## Where it renders
 *
 * In the timeline PANEL's toolbar row (`BottomTimeline`'s sub-header), between
 * the timecode and the transition chips — not in `ViewportTools`, which lives
 * in the transport bar and is about the composition. These are about the
 * TIMELINE's clips and belong to the panel that owns them; a mode armed in one
 * panel and shown in another is how a razor gets left on.
 *
 * The buttons are a `radiogroup`, because that is exactly what they are — one
 * of five, always exactly one. Arrow keys move between them for free. No text
 * label beside them: the tooltip on each button names it and its chord, and
 * the word cost a slot in a row that has to hold the whole panel's tools.
 *
 * `TimelineToolsMenu` is the same controls as one dropdown, for when the
 * toolbar has had to shed the row (see `TIMELINE_TOOLBAR_DEMOTE_ORDER`).
 */

import { useEffect } from 'react';
import { Icon } from '@components/Icon';
import { Dropdown, type DropdownItem } from '@components/Dropdown';
import { cn } from '@utils/cn';
import { usePreferenceStore } from '@stores/preferenceStore';
import {
  TIMELINE_EDIT_MODES,
  installTimelineEditModeCommands,
  useTimelineEditModeStore,
} from './timelineEditMode';
import { installTimelineSnapCommands, toggleTimelineSnap } from './snapCommands';
import { FOLLOW_MODES, type FollowMode } from './playheadFollow';
import styles from './TimelineTools.module.css';

const FOLLOW_ICON: Record<FollowMode, 'eye-off' | 'arrow-right' | 'crosshair'> = {
  off: 'eye-off',
  page: 'arrow-right',
  continuous: 'crosshair',
};

export function TimelineTools(): JSX.Element {
  const mode = useTimelineEditModeStore((s) => s.mode);
  const setMode = useTimelineEditModeStore((s) => s.setMode);
  const snapOn = usePreferenceStore((s) => s.timelineSnap);
  const followMode = usePreferenceStore((s) => s.timelineFollowMode);
  const setPref = usePreferenceStore((s) => s.set);
  const followDef = FOLLOW_MODES.find((f) => f.mode === followMode) ?? FOLLOW_MODES[0]!;

  // Registered from here rather than the app's boot block so the feature is one
  // self-contained unit — same reasoning (and same idempotence) as
  // `installTimelineFitCommands`, which `TimelineZoom` installs the same way.
  useEffect(() => installTimelineEditModeCommands(), []);
  useEffect(() => installTimelineSnapCommands(), []);

  return (
    <div className={styles.tools}>
      <div className={styles.toolGroup} role="radiogroup" aria-label="Timeline edit tool">
      {TIMELINE_EDIT_MODES.map((def) => {
        const active = mode === def.mode;
        return (
          <button
            key={def.mode}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${def.label} tool`}
            className={cn(styles.toolBtn, active && styles.toolBtnActive)}
            // The description carries its weight here: these five gestures are
            // indistinguishable from each other by icon, and a tooltip that
            // only repeated the name would leave the user exactly as stuck.
            title={`${def.label} (${def.chord}) — ${def.description}`}
            onClick={() => setMode(def.mode)}
          >
            <Icon name={def.icon} size="sm" />
          </button>
        );
      })}
      </div>

      {/* Two SWITCHES, outside the radiogroup — they are not one of five, they
          are independently on or off, and putting them inside would break the
          arrow-key traversal the group gets for free. */}
      <span className={styles.toolsDivider} aria-hidden="true" />
      <button
        type="button"
        className={cn(styles.toolBtn, snapOn && styles.toolBtnActive)}
        aria-pressed={snapOn}
        aria-label="Snap in timeline"
        title={
          snapOn
            ? 'Snapping (On) — clip and keyframe drags snap to the playhead, edges, markers and the frame grid. Alt frees one drag. (S with the timeline focused)'
            : 'Snapping (Off) — drags move freely. Alt snaps one drag. (S with the timeline focused)'
        }
        onClick={() => toggleTimelineSnap()}
      >
        <Icon name="magnet" size="sm" />
      </button>
      <button
        type="button"
        className={cn(styles.toolBtn, followMode !== 'off' && styles.toolBtnActive)}
        aria-label={`Playhead follow: ${followDef.label}`}
        title={`Playhead Follow: ${followDef.label} — ${followDef.description} (click to cycle)`}
        onClick={() => {
          const i = FOLLOW_MODES.findIndex((f) => f.mode === followMode);
          setPref('timelineFollowMode', FOLLOW_MODES[(i + 1) % FOLLOW_MODES.length]!.mode);
        }}
      >
        <Icon name={FOLLOW_ICON[followMode]} size="sm" />
      </button>
    </div>
  );
}

/**
 * The same five tools, snap and follow, as one dropdown — the toolbar's shed
 * form. Every row is the same store write the buttons make, so arming a tool
 * from here lights the button the moment the row widens again.
 */
export function TimelineToolsMenu(): JSX.Element {
  const { items, current, snapOn, followDef } = useTimelineToolsMenu();

  return (
    <Dropdown
      placement="bottom-start"
      trigger={
        <button
          type="button"
          className={styles.toolBtn}
          aria-label={`Timeline tools — ${current.label} tool armed`}
          title={`Timeline tools: ${current.label} (${current.chord}) · snap ${snapOn ? 'on' : 'off'} · follow ${followDef.label}`}
        >
          <Icon name={current.icon} size="sm" />
          <Icon name="chevron-down" size="sm" className={styles.chevron} />
        </button>
      }
      items={items}
    />
  );
}

/**
 * The menu's rows and the state its trigger describes, as a hook — so the
 * toolbar's last-resort `⋯` menu (`TimelineToolbarOverflow`) can list the
 * same rows under its own trigger when even the one-button form is too wide.
 */
export function useTimelineToolsMenu(): {
  items: DropdownItem[];
  current: (typeof TIMELINE_EDIT_MODES)[number];
  snapOn: boolean;
  followDef: (typeof FOLLOW_MODES)[number];
} {
  const mode = useTimelineEditModeStore((s) => s.mode);
  const setMode = useTimelineEditModeStore((s) => s.setMode);
  const snapOn = usePreferenceStore((s) => s.timelineSnap);
  const followMode = usePreferenceStore((s) => s.timelineFollowMode);
  const setPref = usePreferenceStore((s) => s.set);
  const current = TIMELINE_EDIT_MODES.find((d) => d.mode === mode) ?? TIMELINE_EDIT_MODES[0]!;
  const followDef = FOLLOW_MODES.find((f) => f.mode === followMode) ?? FOLLOW_MODES[0]!;

  useEffect(() => installTimelineEditModeCommands(), []);
  useEffect(() => installTimelineSnapCommands(), []);

  const items: DropdownItem[] = [
    { type: 'label', label: 'Edit tool' },
    ...TIMELINE_EDIT_MODES.map<DropdownItem>((def) => ({
      type: 'checkbox',
      id: `tl-tool-${def.mode}`,
      label: `${def.label} (${def.chord})`,
      checked: mode === def.mode,
      onChange: () => setMode(def.mode),
    })),
    { type: 'separator' },
    { type: 'checkbox', id: 'tl-tool-snap', label: 'Snap in timeline (S)', checked: snapOn, onChange: () => toggleTimelineSnap() },
    {
      type: 'item',
      id: 'tl-tool-follow',
      label: `Playhead follow: ${followDef.label}`,
      submenu: FOLLOW_MODES.map<DropdownItem>((f) => ({
        type: 'checkbox',
        id: `tl-tool-follow-${f.mode}`,
        label: `${f.label} — ${f.description}`,
        checked: followMode === f.mode,
        onChange: () => setPref('timelineFollowMode', f.mode),
      })),
    },
  ];

  return { items, current, snapOn, followDef };
}

export default TimelineTools;
