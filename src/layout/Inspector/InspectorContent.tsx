/**
 * InspectorContent — the property sections for the selected layer, as one
 * ordered accordion, scoped to ONE Properties sub-tab (or to a search).
 *
 * This file is only the MECHANISM: which sections apply comes from
 * `inspectorSections.ts`, which sub-tab they belong to comes from the same
 * registry, which section is open comes from the preference store, and what a
 * section draws comes from the section. What is left here is the search
 * filter, the remembered open/closed state, and the empty states.
 *
 * Section headers carry no icons. Five of the registry's sections shared the
 * same `sparkles` glyph and three shared `shape`, so the column of icons the
 * accordion used to draw said nothing a reader could use — it only made each
 * header longer. The rail already identifies the panel; the header's job is
 * the section's NAME.
 *
 * `InspectorAccordion` is exported because the Rigging panel is the same
 * mechanism over a different (much shorter) list: one accordion, one search
 * box, the same persisted open/closed behaviour.
 */

import { memo, useCallback, type ComponentType } from 'react';
import { Accordion, type AccordionItem } from '@components/Accordion';
import { EmptyState } from '@components/EmptyState';
import { usePreferenceStore } from '@stores/preferenceStore';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { InspectorSection } from './InspectorSection';
import {
  categoryLabel,
  inspectorSectionsFor,
  resolve,
  sectionCoverage,
  type InspectorSectionDef,
  type InspectorCategory,
} from './inspectorSections';
import styles from '@layout/EditorLayout/panels.module.css';

/**
 * Filter sections by a search query; matches are forced open.
 *
 * The title alone is not enough — searching "color" has to reach Appearance and
 * "shadow" has to reach Layer Styles — so each section carries `keywords`.
 * Those used to live in a `SECTION_KEYWORDS` map in another file entirely,
 * which meant a new section was searchable only if someone remembered to edit
 * two places.
 */
function matchesQuery(def: InspectorSectionDef, nodeId: string, q: string): boolean {
  const title = resolve(def.title, nodeId).toLowerCase();
  return title.includes(q) || (def.keywords ?? '').includes(q);
}

/**
 * The shell around ONE section, memoised on (component, node).
 *
 * The panel re-renders for reasons that are none of a section's business — a
 * keystroke in the search box, a switch in the selection header, the tab strip
 * — and every re-render used to rebuild every section's element tree and run
 * every section's render. With the host memoised, a section renders again only
 * when its own node's revision moves (`useNodeRevision` inside it) or when the
 * node it is drawn for changes.
 */
const SectionHost = memo(function SectionHost({
  Component,
  nodeId,
}: {
  Component: ComponentType<{ nodeId: string }>;
  nodeId: string;
}): JSX.Element {
  return (
    <InspectorSection>
      <Component nodeId={nodeId} />
    </InspectorSection>
  );
});

/**
 * One registry row → one accordion item, drawn in the shared section shell.
 *
 * A search result carries its sub-tab's name as the header badge, so a hit
 * found from the search box also tells you where it lives once you stop
 * searching. That badge is the answer to "which tab owns this property".
 *
 * With several layers selected, a section that only some of them have is
 * badged "2 of 3" — the rows inside edit every layer that has the property,
 * and the badge says how many that is.
 */
function toAccordionItem(
  def: InspectorSectionDef,
  nodeId: string,
  searching: boolean,
  nodeIds: ReadonlyArray<string>,
): AccordionItem {
  const { Component } = def;
  const coverage = nodeIds.length > 1 ? sectionCoverage(def, nodeIds) : nodeIds.length;
  const partial = nodeIds.length > 1 && coverage < nodeIds.length ? `${coverage} of ${nodeIds.length}` : null;
  const badge = searching
    ? (partial ? `${categoryLabel(def.category)} · ${partial}` : categoryLabel(def.category))
    : partial ?? undefined;
  return {
    id: def.id,
    title: resolve(def.title, nodeId),
    defaultOpen: def.defaultOpen === undefined ? undefined : resolve(def.defaultOpen, nodeId),
    mountOnOpen: def.mountOnOpen,
    // `forceOpen`, not `defaultOpen`: a remembered "closed" for this section
    // outranks defaultOpen, and would otherwise hide the hit you searched for.
    ...(searching ? { forceOpen: true } : {}),
    ...(badge !== undefined ? { badge } : {}),
    content: <SectionHost Component={Component} nodeId={nodeId} />,
  };
}

/**
 * Shared accordion render for the Properties and Rigging panels, applying the
 * user's remembered open/closed sections.
 */
export function InspectorAccordion({ items }: { items: AccordionItem[] }): JSX.Element {
  // Remembered per section id and persisted, so the Inspector reopens the way
  // you left it. Local `useState` could not do this: the panel unmounts on
  // every tab switch and whenever the selection is cleared, which is why
  // Transform sprang back open however often you collapsed it.
  const sections = usePreferenceStore((s) => s.inspectorSections);
  const setPref = usePreferenceStore((s) => s.set);
  const onToggle = useCallback(
    (id: string, open: boolean) => {
      setPref('inspectorSections', { ...usePreferenceStore.getState().inspectorSections, [id]: open });
    },
    [setPref],
  );
  // No `key={query}` upstream: keying on the search text REMOUNTED the whole
  // Accordion on every keystroke, throwing away every section's DOM (and any
  // in-flight edit inside one) on each character typed.
  //
  // No wrapper padding: a 4px inset stopped the section hairlines short of the
  // panel edge and pushed each section's gutter to 16px, while the search box
  // above sat at 8px — three different left edges down one narrow column.
  return <Accordion items={items} openOverrides={sections} onToggle={onToggle} />;
}

/** Legacy signature kept for the Rigging panel's kind-branch call sites. */
export function renderInspector(items: AccordionItem[], query: string): JSX.Element {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? items
        .filter((it) => (typeof it.title === 'string' ? it.title.toLowerCase().includes(q) : false))
        .map((it) => ({ ...it, forceOpen: true }))
    : items;
  if (q && filtered.length === 0) {
    return <EmptyState compact icon="search" message={`No properties match “${query.trim()}”.`} />;
  }
  return <InspectorAccordion items={filtered} />;
}

export interface InspectorContentProps {
  nodeId: string | null;
  /** A non-empty query searches EVERY sub-tab; `category` is then ignored. */
  query?: string;
  /** The sub-tab to draw. `'all'` draws every section — the search view. */
  category?: InspectorCategory | 'all';
  /**
   * The whole selection, primary first. Only the coverage badges read it here;
   * the rows reach it through `InspectorSelectionProvider`.
   */
  nodeIds?: ReadonlyArray<string>;
}

export function InspectorContent({ nodeId, query = '', category = 'all', nodeIds }: InspectorContentProps): JSX.Element {
  if (!nodeId) {
    return (
      <EmptyState
        icon="mouse-pointer"
        title="No selection"
        message="Select a layer to edit its transform, style, layer settings and animation."
      />
    );
  }

  if (!defaultSceneGraph.getNode(nodeId)) return <div className={styles.empty}>No node data</div>;

  const q = query.trim().toLowerCase();
  const scope = q ? 'all' : category;
  const all = inspectorSectionsFor(nodeId, scope);
  if (all.length === 0) {
    if (scope !== 'all') {
      return <EmptyState compact icon="info" message={`No ${categoryLabel(scope).toLowerCase()} properties for this layer.`} />;
    }
    return <EmptyState icon="info" message="This layer type has no editable properties." />;
  }

  const matched = q ? all.filter((def) => matchesQuery(def, nodeId, q)) : all;
  if (q && matched.length === 0) {
    return <EmptyState compact icon="search" message={`No properties match “${query.trim()}”.`} />;
  }

  const selection = nodeIds && nodeIds.length > 0 ? nodeIds : [nodeId];
  return <InspectorAccordion items={matched.map((def) => toAccordionItem(def, nodeId, q.length > 0, selection))} />;
}

export default InspectorContent;
