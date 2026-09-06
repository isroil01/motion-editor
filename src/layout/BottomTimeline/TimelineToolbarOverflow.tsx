/**
 * The timeline toolbar's last resort — one `⋯` holding everything the left
 * column has had to give up.
 *
 * The column is exactly as wide as the track-header column beneath it, and
 * that column can be dragged down to `TRACK_HEADER_MIN_WIDTH`. The first two
 * rungs of the ladder swap the transition chips and the edit tools for their
 * one-button menus; at the third, even those two buttons plus View and the
 * cache actions do not fit beside the timecode, the filter and Graph Editor,
 * so all four fold into this one trigger. Nothing is merely hidden: every row
 * that was a button is a row here, reaching the same store or command.
 *
 * The menu is FLAT where it can be. `Dropdown` renders one level of submenu,
 * and the View rows and the tools' follow row carry submenus of their own, so
 * those two groups are listed at the top level under a label rather than
 * nested a level too deep to open. Transitions and the cache, whose rows are
 * plain, get a submenu each.
 */

import { Icon } from '@components/Icon';
import { Dropdown, type DropdownItem } from '@components/Dropdown';
import { useTimelineToolsMenu } from '@layout/Timeline/TimelineTools';
import { transitionsMenuItems } from '@layout/Timeline/transitionPalette';
import { previewCacheMenuItems, usePreviewCacheStats } from '@layout/Timeline/CacheActions';
import styles from './BottomTimeline.module.css';

export interface TimelineToolbarOverflowProps {
  /** The View menu's rows, built by the panel (they read a dozen stores). */
  viewItems: ReadonlyArray<DropdownItem>;
}

export function TimelineToolbarOverflow({ viewItems }: TimelineToolbarOverflowProps): JSX.Element {
  const tools = useTimelineToolsMenu();
  const cache = usePreviewCacheStats();

  const items: DropdownItem[] = [
    ...tools.items,
    { type: 'separator' },
    { type: 'item', id: 'tl-more-transitions', icon: 'wipe', label: 'Transitions', submenu: transitionsMenuItems() },
    { type: 'separator' },
    { type: 'label', label: 'View' },
    ...viewItems,
    { type: 'separator' },
    { type: 'item', id: 'tl-more-cache', icon: 'refresh', label: 'Preview cache', submenu: previewCacheMenuItems(cache.stats, cache.refresh) },
  ];

  return (
    <Dropdown
      placement="bottom-end"
      trigger={
        <button
          type="button"
          className={styles.toggleIcon}
          aria-label="More timeline tools"
          title={`More timeline tools — ${tools.current.label} tool armed · transitions · view · preview cache. Widen the track header column to bring them back.`}
        >
          <Icon name="more-horizontal" size="sm" />
        </button>
      }
      items={items}
    />
  );
}
