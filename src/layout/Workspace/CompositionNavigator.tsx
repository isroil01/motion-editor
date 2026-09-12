/**
 * CompositionNavigator — AE's Composition Navigator bar, along the top of the
 * viewer.
 *
 * It shows the active tab's trail of compositions in AE's default "Flow Right
 * To Left" order: downstream (containing) comps on the left, dimmed because
 * none of their content is in view, and upstream (nested) comps on the right.
 * The arrows point the way the pixels flow — out of a nested comp into the one
 * that contains it. Clicking a name opens that comp with the playhead mapped
 * across (see `core/composition/compNavigation`).
 *
 * Only drawn once there is somewhere to go: a top-level comp opened from a
 * list has a trail of one, and a bar holding a single name would be chrome for
 * its own sake.
 */

import { useEffect } from 'react';
import { Icon } from '@components/Icon';
import { cn } from '@utils/cn';
import { useProjectStore } from '@stores/projectStore';
import { useMiniFlowchartStore } from '@stores/miniFlowchartStore';
import { useSceneRevision } from '@stores/sceneStore';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { installCompNavigation, navigateToCrumb } from '@core/composition/compNavigation';
import styles from './CompositionNavigator.module.css';

export function CompositionNavigator(): JSX.Element | null {
  // The bar is always mounted with the viewer, so it owns the repair that
  // steps out of a tab whose group was undone away.
  useEffect(() => installCompNavigation(), []);
  useSceneRevision((s) => s.rev);
  const path = useProjectStore((s) => (s.activeTabId ? s.tabs[s.activeTabId]?.breadcrumbPath : undefined));
  const current = useProjectStore((s) => (s.activeTabId ? s.tabs[s.activeTabId]?.compositionId : undefined));
  const comps = useProjectStore((s) => s.comps);

  if (!path || !current) return null;
  const at = path.indexOf(current);
  if (at < 0) return null;
  // A comp that no longer exists drops out of the trail rather than leaving a
  // name that does nothing when clicked.
  const crumbs = path
    .map((id, index) => ({ id, index, node: defaultSceneGraph.getNode(id) }))
    .filter((c) => c.node);
  if (crumbs.length < 2) return null;

  return (
    <nav className={styles.bar} aria-label="Composition Navigator">
      {crumbs.map((c, i) => {
        const name = comps[c.id]?.name ?? c.node?.name ?? c.id;
        const isCurrent = c.index === at;
        const downstream = c.index < at;
        return (
          <span key={`${c.index}_${c.id}`} className={styles.crumbWrap}>
            {i > 0 ? <Icon name="chevron-left" size="sm" className={styles.flow} /> : null}
            <button
              type="button"
              className={cn(styles.crumb, downstream && styles.downstream, isCurrent && styles.current)}
              aria-current={isCurrent ? 'page' : undefined}
              disabled={isCurrent}
              title={
                isCurrent
                  ? `${name} — the composition in this viewer`
                  : downstream
                    ? `Open ${name}, which contains this composition (Shift+Esc goes back)`
                    : `Open ${name}, nested in this composition`
              }
              onClick={() => navigateToCrumb(c.index)}
            >
              {name}
            </button>
          </span>
        );
      })}
      {/* AE: the arrow after the names opens the Composition Mini-Flowchart. */}
      <button
        type="button"
        className={styles.flowchartBtn}
        title="Composition Mini-Flowchart (Tab)"
        aria-label="Open the Composition Mini-Flowchart"
        onClick={() => useMiniFlowchartStore.getState().toggle()}
      >
        <Icon name="chevron-down" size="sm" />
      </button>
    </nav>
  );
}

export default CompositionNavigator;
