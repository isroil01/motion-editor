import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from '@components/Icon';
import { Logo } from '@components/Logo';
import { AppMenuBar } from '@layout/Menu';
import { IconButton } from '@components/IconButton';
import { Dropdown } from '@components/Dropdown';
import { openCustomizeDialog } from '@layout/Settings/CustomizeDialog';
import { buildWorkspaceItems } from '@layout/Workspace/workspaceMenuItems';
import { useLayoutStore } from '@stores/layoutStore';
import { usePresentationStore } from '@stores/presentationStore';
import { useCompositionStore } from '@stores/compositionStore';
import { openExportDialog } from '@layout/Export/ExportDialog';
import { ProjectStatus } from '@layout/ProjectStatus/ProjectStatus';
import { AccountButton } from '@layout/Auth/AccountButton';
import { useNativeMenuSync } from '@layout/Menu/useNativeMenuSync';
import { UpdateButton } from './UpdateButton';
import styles from './TitleBar.module.css';

/**
 * Keeps the native (Alt) menu generated from the same model the in-app bar
 * draws. A component rather than a bare hook call so it mounts only on the
 * editor route — the groups it serialises name commands that exist there.
 */
function NativeMenuSync(): null {
  useNativeMenuSync();
  return null;
}

export function TitleBar(): JSX.Element | null {
  const [isMaximized, setIsMaximized] = useState(false);
  const location = useLocation();
  const isEditor = location.pathname.startsWith('/editor');
  const isElectron = typeof window !== 'undefined' && (!!window.motionEditor || !!window.electronAPI);

  const leftCollapsed = useLayoutStore((s) => s.regions.leftSidebar?.collapsed);
  const bottomCollapsed = useLayoutStore((s) => s.regions.bottomTimeline?.collapsed);
  const rightCollapsed = useLayoutStore((s) => s.regions.rightInspector?.collapsed);
  const enterPresentation = usePresentationStore((s) => s.enter);
  const compFps = useCompositionStore((s) => s.fps);
  const compDuration = useCompositionStore((s) => s.durationSeconds);



  if (!isElectron) return null;

  const handleMinimize = () => {
    window.electronAPI?.window?.minimize?.();
  };

  const handleMaximize = () => {
    window.electronAPI?.window?.maximize?.();
    setIsMaximized(!isMaximized);
  };

  const handleClose = () => {
    window.electronAPI?.window?.close?.();
  };

  return (
    <div className={styles.titleBar}>
      <div className={styles.dragRegion} />
      <div className={styles.left}>
        <Logo variant="mark" size={18} className={styles.appIconBadge} />
        {isEditor && (
          <>
            <span className={styles.menuDivider} aria-hidden />
            <div className={styles.appMenuBarWrapper}>
              <AppMenuBar />
            </div>
          </>
        )}
      </div>
      {/* Centre: which project, whether it is saved, how long ago. The web
          build mounts the same component in TopNav's centre. */}
      {isEditor && (
        <div className={styles.center}>
          <NativeMenuSync />
          <ProjectStatus />
        </div>
      )}
      <div className={styles.right}>
        {/* First in the cluster, and far from Export: a pending update is the
            one thing here the user has not already gone looking for. Renders
            nothing when nothing is pending, which is almost always. */}
        <UpdateButton />
        {isEditor && (
          <div className={styles.editorControls}>
            <IconButton
              aria-label="Toggle Left Sidebar"
              size="sm"
              className={styles.layoutToggle}
              active={!leftCollapsed}
              title="Toggle Left Sidebar"
              onClick={() => useLayoutStore.getState().toggleRegion('leftSidebar')}
            >
              <Icon name="panel-left" size="md" />
            </IconButton>
            <IconButton
              aria-label="Toggle Bottom Timeline"
              size="sm"
              className={styles.layoutToggle}
              active={!bottomCollapsed}
              title="Toggle Bottom Timeline"
              onClick={() => useLayoutStore.getState().toggleRegion('bottomTimeline')}
            >
              <Icon name="panel-bottom" size="md" />
            </IconButton>
            <IconButton
              aria-label="Toggle Right Inspector"
              size="sm"
              className={styles.layoutToggle}
              active={!rightCollapsed}
              title="Toggle Right Inspector"
              onClick={() => useLayoutStore.getState().toggleRegion('rightInspector')}
            >
              <Icon name="panel-right" size="md" />
            </IconButton>
            <span className={styles.menuDivider} aria-hidden />
            <Dropdown
              placement="bottom-end"
              trigger={
                <IconButton
                  aria-label="Workspaces"
                  size="sm"
                  className={styles.layoutToggle}
                  title="Workspaces & Layout Presets"
                >
                  <Icon name="layout" size="md" />
                </IconButton>
              }
              items={buildWorkspaceItems()}
            />
            <IconButton
              aria-label="Customize"
              size="sm"
              className={styles.layoutToggle}
              title="Customize (Shortcuts, Workspaces, Appearance)"
              onClick={() => openCustomizeDialog()}
            >
              <Icon name="settings" size="md" />
            </IconButton>
            <span className={styles.menuDivider} aria-hidden />
            <button
              type="button"
              className={styles.previewBtn}
              title="Preview presentation (Fullscreen)"
              onClick={() => enterPresentation()}
            >
              <Icon name="play" size="sm" weight="fill" />
              <span>Preview</span>
            </button>
            <button
              type="button"
              className={styles.exportBtn}
              title="Export composition…"
              onClick={() => openExportDialog(compDuration, compFps)}
            >
              <Icon name="export" size="sm" weight="bold" />
              <span>Export</span>
            </button>
            {/* Account, up from the status bar: beside Preview and Export is
                where "who am I signed in as" belongs. Renders nothing in the
                local edition. */}
            <AccountButton />
          </div>
        )}
        <div className={styles.windowActions}>
          <button type="button" onClick={handleMinimize} className={styles.btn} title="Minimize">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
          <button type="button" onClick={handleMaximize} className={styles.btn} title={isMaximized ? 'Restore' : 'Maximize'}>
            {isMaximized ? (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="3.5" y="1.5" width="5" height="5" rx="0.8" stroke="currentColor" strokeWidth="1" />
                <rect x="1.5" y="3.5" width="5" height="5" rx="0.8" fill="var(--color-titlebar, #141416)" stroke="currentColor" strokeWidth="1" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                <rect x="1.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.2" />
              </svg>
            )}
          </button>
          <button type="button" onClick={handleClose} className={`${styles.btn} ${styles.btnClose}`} title="Close">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 2L8 8M8 2L2 8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default TitleBar;
