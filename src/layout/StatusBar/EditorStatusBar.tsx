/**
 * EditorStatusBar — everything the bottom strip shows, wired to its stores.
 *
 * Extracted from App.tsx, where all of this sat as ~100 lines of inline
 * styles (one of them a hover colour applied by mutating `style` in
 * onMouseOver). App.tsx now passes the one thing it derives itself — the
 * layer count — and this owns the rest.
 *
 *   left    save state · N layers · N selected · info readout
 *   centre  the composition chip (name, size, fps, dirty dot)
 *   right   job tray · VU · timeline zoom · fps · timecode · video health · search
 *
 * The account button used to end this row. It is in the top bar's right
 * cluster now (TopNav on the web, the title bar in Electron), beside Preview
 * and Export, where "who am I signed in as" belongs.
 */

import { Icon } from '@components/Icon';
import { Kbd } from '@components/Kbd';
import { cn } from '@utils/cn';
import { useProjectStore } from '@stores/projectStore';
import { useSelectionStore } from '@stores/selectionStore';
import { useCompositionStore } from '@stores/compositionStore';
import { openPalette } from '@stores/commandPaletteStore';
import { openCompositionSettings } from '@layout/Composition/CompositionSettingsDialog';
import { StatusBar } from './StatusBar';
import { FpsMeter } from './FpsMeter';
import { InfoReadout } from './InfoReadout';
import { VUMeter } from './VUMeter';
import { TimelineZoom } from './TimelineZoom';
import { StatusBarTimecode } from './StatusBarTimecode';
import { VideoHealth } from './VideoHealth';
import { JobTray } from './JobTray';
import styles from './EditorStatusBar.module.css';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export interface EditorStatusBarProps {
  /** Layers in the active composition, as the timeline derives them. */
  layerCount: number;
}

function Sep(): JSX.Element {
  return <span className={styles.dot} aria-hidden>·</span>;
}

export function EditorStatusBar({ layerCount }: EditorStatusBarProps): JSX.Element {
  const selectionCount = useSelectionStore((s) => s.ids.length);
  const activeDirty = useProjectStore((s) => (s.activeTabId ? s.tabs[s.activeTabId]?.dirty ?? false : false));
  const activeTitle = useProjectStore((s) => (s.activeTabId ? s.tabs[s.activeTabId]?.title : undefined));
  const compFps = useCompositionStore((s) => s.fps);
  const compWidth = useCompositionStore((s) => s.width);
  const compHeight = useCompositionStore((s) => s.height);
  const compStartFrame = useCompositionStore((s) => s.startFrame);

  return (
    <StatusBar
      left={
        <>
          {/* Real state, not a hardcoded "Ready": amber while unsaved. */}
          <span className={cn(styles.stateDot, activeDirty && styles.stateDotDirty)} aria-hidden>●</span>
          <span>{activeDirty ? 'Unsaved changes' : 'Ready'}</span>
          <Sep />
          <span>{layerCount} layers</span>
          {selectionCount > 0 ? (
            <>
              <Sep />
              <span>{selectionCount} selected</span>
            </>
          ) : null}
          <Sep />
          <InfoReadout />
        </>
      }
      center={
        <button
          type="button"
          className={styles.comp}
          title="Composition settings"
          onClick={() => openCompositionSettings()}
        >
          <Icon name="layers" size="sm" className={styles.compIcon} />
          <span className={styles.compName}>{activeTitle ?? 'Untitled'}</span>
          <span className={styles.compMeta}>
            {compWidth}×{compHeight} · {compFps}fps
          </span>
          {activeDirty ? (
            <span aria-label="Unsaved changes" title="Unsaved changes" className={styles.dirtyDot} />
          ) : null}
        </button>
      }
      right={
        <>
          <JobTray />
          <VUMeter />
          {/* Timeline zoom. It had a 22px footer row to itself at the
              bottom of the timeline panel, empty across its whole left
              half; the status bar is already the strip for readouts you
              glance at and occasionally poke. */}
          <TimelineZoom />
          <Sep />
          <FpsMeter />
          <Sep />
          <StatusBarTimecode fps={compFps} startFrame={compStartFrame} />
          <VideoHealth />
          <Sep />
          <button
            type="button"
            className={styles.search}
            data-tour="command-palette"
            onClick={() => openPalette()}
            title="Search commands, layers, effects, presets… (? for docs)"
          >
            <Icon name="search" size="sm" />
            Search
            <Kbd size="sm" chord={IS_MAC ? '⌘⇧P' : 'Ctrl+Shift+P'} />
          </button>
        </>
      }
    />
  );
}
