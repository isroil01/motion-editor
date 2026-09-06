/**
 * EffectsSection — the layer's effect stack, inside the Properties panel.
 *
 * After Effects splits Effect Controls from the layer's other properties
 * because it always has; the split is historical, not useful. Here the stack
 * is one more sub-tab of the same inspector, so the separate Effect Controls
 * dock panel becomes optional (its panel id stays registered for anyone who
 * wants it as a second, pinned surface).
 *
 * `EffectStack` is imported as-is: it already owns drag-reorder, presets,
 * copy/paste and the keyframed parameter rows, and duplicating any of that
 * here would be a second stack to keep in step with the first.
 */

import { memo } from 'react';
import { Button } from '@components/Button';
import { EffectStack } from '@layout/Effects/EffectStack';
import { getNodeEffects } from '@core/effects/effects';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { useLayoutStore } from '@stores/layoutStore';
import { useNodeRevision } from '@core/inspector/nodeRevision';
import { useInspectorSelection } from './inspectorSelection';
import { sharedEffectSlots } from '@core/inspector/multiSelection';
import styles from '@layout/EditorLayout/panels.module.css';

function EffectsSectionInner({ nodeId }: { nodeId: string }): JSX.Element | null {
  useNodeRevision(nodeId);
  const nodeIds = useInspectorSelection(nodeId);
  const node = defaultSceneGraph.getNode(nodeId);
  if (!node) return null;
  const count = getNodeEffects(nodeId).length;
  const shared = nodeIds.length > 1 ? sharedEffectSlots(nodeIds).length : 0;

  return (
    <>
      {nodeIds.length > 1 && (
        <p className={styles.sectionNote}>
          Editing the effects of the primary layer. {shared} of {count} effect{count === 1 ? '' : 's'} sit at the
          same position on all {nodeIds.length} selected layers.
        </p>
      )}
      {count > 0 ? (
        <EffectStack nodeId={nodeId} />
      ) : (
        <div className={styles.groupMeta}>
          <span className={styles.groupCount}>No effects on this layer.</span>
          <Button size="sm" variant="secondary" fullWidth onClick={() => useLayoutStore.getState().openPanel('effects')}>
            Browse Effects &amp; Presets
          </Button>
        </div>
      )}
    </>
  );
}


/*
 * Memoized: the Properties panel re-renders for its own reasons (a selection
 * change, a sub-tab switch, the sticky header) and hands every section the
 * same `nodeId` it had before. Without this boundary the section would rebuild
 * its whole subtree on each of those, undoing the per-node subscriptions the
 * rows inside it use to stay asleep. Pinned by `inspectorRenderScope.test.tsx`.
 */
export const EffectsSection = memo(EffectsSectionInner);

export default EffectsSection;
