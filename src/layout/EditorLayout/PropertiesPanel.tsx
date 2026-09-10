/**
 * PropertiesPanel — the inspector for whatever is selected, in sub-tabs.
 *
 * ## History, because the shape has flipped twice
 *
 * This was once three dock tabs — Transform, Style, Settings — and each was an
 * accordion of property sections with its own search box that could not see
 * the other two. Picking a camera while Style was active showed nothing, so a
 * selection effect had to auto-switch tabs. They were merged into one panel
 * (2026-08-03) to end the guessing.
 *
 * The merge over-corrected: a plain shape then showed EIGHT section headers in
 * one column, and the section you wanted was below the fold behind a wall of
 * uppercase titles. So the sections are grouped again — but INSIDE the panel,
 * under one header and one search box, and with the two failure modes of the
 * old split designed out:
 *
 *   • a sub-tab is only offered when the selected layer has a section in it,
 *     and a remembered tab the new layer lacks falls back to the first it has,
 *     so a selection never lands on an empty screen;
 *   • the search box reads across every sub-tab, and each hit is badged with
 *     the tab it lives in — so "where is X" is answered by typing X.
 *
 * ## The selection, not the first selected layer (2026-09-04)
 *
 * The panel used to read `selected[0]` and stop. Now every section is drawn for
 * the PRIMARY layer and edits ALL selected layers, through
 * `InspectorSelectionProvider`: a row whose values disagree shows `—`, a drag
 * offsets every layer, a typed `+10` is evaluated per layer, and every gesture
 * is one undo entry (`core/inspector/multiSelection.ts`). A section only some
 * of the selection has is badged "2 of 3" in its header.
 *
 * ## What re-renders when
 *
 * The shell subscribes to the SELECTION's node revisions, not the scene's: a
 * scrub on an unselected layer no longer re-renders this panel at all, and a
 * scrub on a selected one re-renders the rows that read it. Each section sits
 * in a memoised host (`InspectorContent`), so a keystroke in the search box
 * does not run twenty section renders.
 *
 * The panel is the SHELL only: the sticky selection header, the tab strip, the
 * search and the scroller. Which sections exist, in what order and in which
 * tab is `inspectorSections.ts`; how they render is `InspectorContent`.
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Panel } from '@components/Panel';
import { SearchField } from '@components/SearchField';
import { Icon } from '@components/Icon';
import { Dropdown, type DropdownItem } from '@components/Dropdown';
import { useDockPanelHeader } from '@components/DockPanel';
import { useSelectionStore } from '@stores/selectionStore';
import { useTemplateStore } from '@stores/templateStore';
import { usePreferenceStore } from '@stores/preferenceStore';
import { useLayoutStore } from '@stores/layoutStore';
import { getEventBus } from '@core/events/EventBus';
import { getCommandRegistry } from '@core/commands/Command';
import { asCommandId } from '@app-types/common';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { useNodesRevision } from '@core/inspector/nodeRevision';
import { InspectorContent } from '@layout/Inspector/InspectorContent';
import { InspectorSelectionProvider } from '@layout/Inspector/inspectorSelection';
import { SelectionHeader } from '@layout/Inspector/SelectionHeader';
import {
  INSPECTOR_CATEGORIES,
  inspectorCategoriesFor,
  type InspectorCategory,
} from '@layout/Inspector/inspectorSections';
import { MographParamsSection } from '@layout/Inspector/MographParamsSection';
import { ActiveTemplateFields } from '@layout/Templates/TemplateFieldsPanel';
import { cn } from '@utils/cn';
import styles from './panels.module.css';

/** The applied template's fields, or nothing when no template is applied. */
function TemplateFieldsSection(): JSX.Element | null {
  const active = useTemplateStore((s) => s.active);
  if (!active) return null;
  return <ActiveTemplateFields />;
}

/**
 * The sub-tabs the SELECTION offers: the union over every selected layer, in
 * display order. A tab the primary lacks still lists — its sections apply to
 * the other layers — but the accordion inside draws the primary's sections,
 * so such a tab shows the "no … properties for this layer" state with the
 * coverage badges explaining why.
 */
function categoriesForSelection(nodeIds: ReadonlyArray<string>): InspectorCategory[] {
  const present = new Set<InspectorCategory>();
  for (const id of nodeIds) {
    if (!defaultSceneGraph.getNode(id)) continue;
    for (const c of inspectorCategoriesFor(id)) present.add(c);
  }
  return INSPECTOR_CATEGORIES.map((c) => c.id).filter((id) => present.has(id));
}

/** Show the Properties panel on a given sub-tab — the commands below. */
function showInspectorTab(tab: InspectorCategory): void {
  usePreferenceStore.getState().set('inspectorTab', tab);
  useLayoutStore.getState().openPanel('properties');
}

/**
 * Commands, registered once at module load — the same lazy pattern as the
 * tour command: on a pre-boot route the registry is not there yet and
 * Providers registers during boot.
 *
 * Menu rows wanted (menuModel.ts is not this file's to edit):
 *   View ▸ Inspector ▸ Keyframe Lanes           → inspector.toggleKeyframeLanes
 *   Window ▸ Properties ▸ Pinned / Effects tab  → inspector.showPinned / inspector.showEffects
 */
function registerInspectorCommands(): void {
  try {
    const reg = getCommandRegistry();
    reg.register({
      id: asCommandId('inspector.toggleKeyframeLanes'),
      label: 'Toggle Keyframe Lanes in Properties',
      description: 'Draw a mini keyframe strip under every animated property row',
      icon: 'keyframe',
      enabled: () => true,
      isChecked: () => usePreferenceStore.getState().inspectorShowLane,
      execute: () => {
        const s = usePreferenceStore.getState();
        s.set('inspectorShowLane', !s.inspectorShowLane);
      },
    });
    reg.register({
      id: asCommandId('inspector.showPinned'),
      label: 'Properties: Pinned Tab',
      description: 'Show the selected layer’s pinned and essential properties',
      icon: 'push-pin',
      enabled: () => true,
      execute: () => showInspectorTab('pinned'),
    });
    reg.register({
      id: asCommandId('inspector.showEffects'),
      label: 'Open Effect Controls Panel',
      description: 'Show the selected layer’s effect stack in the Effect Controls panel',
      icon: 'sparkles',
      enabled: () => true,
      execute: () => useLayoutStore.getState().openPanel('effectControls'),
    });
  } catch {
    /* no registry yet (a pre-boot route) */
  }
}

registerInspectorCommands();

export function PropertiesPanel(): JSX.Element {
  const selected = useSelectionStore((s) => s.ids);
  const primary = selected[0] ?? null;
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // The SELECTION's revisions, not the scene's — see the module note.
  useNodesRevision(selected);
  const node = primary ? defaultSceneGraph.getNode(primary) : null;

  // The remembered sub-tab, resolved against what THIS selection offers.
  const preferredTab = usePreferenceStore((s) => s.inspectorTab);
  const showLane = usePreferenceStore((s) => s.inspectorShowLane);
  const setPref = usePreferenceStore((s) => s.set);
  const available: InspectorCategory[] = primary && node ? categoriesForSelection(selected) : [];
  const activeTab: InspectorCategory | null = available.length === 0
    ? null
    : available.includes(preferredTab) ? preferredTab : available[0]!;

  // Closing the search clears it; a hidden non-empty query would silently keep
  // the panel in search view with no field on screen to say so.
  useEffect(() => {
    if (!searchOpen) setQuery('');
  }, [searchOpen]);

  const searching = query.trim().length > 0;

  const menuItems: DropdownItem[] = [
    {
      type: 'checkbox',
      id: 'lanes',
      label: 'Keyframe lanes under animated rows',
      checked: showLane,
      onChange: (v) => setPref('inspectorShowLane', v),
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'effect-controls',
      label: 'Open Effect Controls panel',
      icon: 'sparkles',
      onSelect: () => useLayoutStore.getState().openPanel('effectControls'),
    },
  ];

  const dockHeader = useDockPanelHeader();
  const setCustomMenuItems = dockHeader?.setCustomMenuItems;

  useEffect(() => {
    if (!setCustomMenuItems) return;
    setCustomMenuItems(menuItems);
    return () => setCustomMenuItems([]);
  }, [setCustomMenuItems, menuItems]);

  const searchButton = (
    <button
      type="button"
      className={cn(styles.layerHeadBtn, searchOpen && styles.layerHeadBtnActive)}
      aria-label={searchOpen ? 'Close property search' : 'Search properties'}
      aria-pressed={searchOpen}
      title="Search properties"
      onClick={() => setSearchOpen((v) => !v)}
    >
      <Icon name="search" size="sm" />
    </button>
  );

  const fallbackActions = (
    <>
      {searchButton}
      {!dockHeader?.target && (
        <Dropdown
          items={menuItems}
          placement="bottom-end"
          trigger={
            <button type="button" className={styles.layerHeadBtn} aria-label="Properties panel options" title="Options">
              <Icon name="more-horizontal" size="sm" />
            </button>
          }
        />
      )}
    </>
  );

  const headerActions = dockHeader?.target ? searchButton : fallbackActions;
  const headerContent = <SelectionHeader nodeIds={selected} actions={headerActions} />;

  return (
    <Panel
      id="properties"
      title="Properties"
      icon="settings"
      hideHeader
      noScroll
      onClose={() => getEventBus().emit('PanelClosed', { panelId: 'properties' })}
    >
      <div className={styles.inspectorShell}>
        {/* Layer switch buttons moved to the Properties sidebar title at the top.
            If rendered without a DockPanel (e.g. standalone test), falls back to layerHead. */}
        {primary && node && (
          dockHeader?.target
            ? createPortal(headerContent, dockHeader.target)
            : <div className={styles.layerHead}>{headerContent}</div>
        )}
        {primary && node && searchOpen && (
          <div className={styles.searchRow}>
            <SearchField
              placeholder="Search all properties…"
              ariaLabel="Search properties"
              value={query}
              onChange={setQuery}
              autoFocus
            />
          </div>
        )}
        {/* The sub-tabs. Hidden while a search is live: the results span every
            tab and are badged with their own, so a strip claiming one tab is
            active would be telling a lie about what is on screen. */}
        {primary && node && !searching && available.length > 1 && (
          <div className={styles.inspectorTabs} role="tablist" aria-label="Property groups">
            {INSPECTOR_CATEGORIES.filter((c) => available.includes(c.id)).map((c) => {
              const isActive = c.id === activeTab;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  className={cn(styles.inspectorTab, isActive && styles.inspectorTabActive)}
                  onClick={() => setPref('inspectorTab', c.id)}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        )}
        <div className={styles.inspectorBody}>
          <InspectorSelectionProvider nodeIds={selected}>
            <InspectorContent nodeId={primary} nodeIds={selected} query={query} category={activeTab ?? 'all'} />
          </InspectorSelectionProvider>
          {/* Not sections of the SELECTION: mograph parameters belong to the
              mograph player and template fields to the applied template, so
              neither can live in a registry keyed on the selected layer. */}
          <div className={styles.inspectorExtras}>
            <MographParamsSection />
            <TemplateFieldsSection />
          </div>
        </div>
      </div>
    </Panel>
  );
}

export default PropertiesPanel;
