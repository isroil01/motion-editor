import { useMemo, useState } from 'react';
import { useSelectionStore } from '@stores/selectionStore';
import { useSceneRevision } from '@stores/sceneStore';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { readNodeKind } from '@core/scene/sceneDerive';
import { TrackMotionSection } from './TrackMotionSection';
import styles from './CharacterPanel.module.css';

export function TrackerPanel(): JSX.Element {
  const selected = useSelectionStore((s) => s.ids);
  const sceneRev = useSceneRevision((s) => s.rev);

  // Find all video layers in the current composition to offer as Motion Source
  const videoLayers = useMemo(() => {
    const list: { id: string; name: string }[] = [];
    defaultSceneGraph.traverse((node) => {
      const kind = readNodeKind(node);
      if (kind === 'video' || kind === 'image') {
        list.push({ id: node.id, name: node.name || node.id });
      }
    });
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sceneRev triggers re-traversal when graph changes
  }, [sceneRev]);

  const [chosenSourceId, setChosenSourceId] = useState<string | null>(null);

  // Determine active source layer: selected layer if video, or chosenSourceId, or first available video layer
  const primarySelected = selected[0] ?? null;
  const primaryNode = primarySelected ? defaultSceneGraph.getNode(primarySelected) : null;
  const isPrimaryVideo = primaryNode ? readNodeKind(primaryNode) === 'video' || readNodeKind(primaryNode) === 'image' : false;

  const activeSourceId = isPrimaryVideo ? primarySelected : (chosenSourceId ?? videoLayers[0]?.id ?? null);

  if (!activeSourceId) {
    return (
      <div className={styles.root}>
        <div className={styles.emptyHint}>
          No video or footage layer found in composition. Import a video footage file to use Motion Tracking, Camera Tracking, or Warp Stabilization.
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.col} style={{ marginBottom: 'var(--space-2)' }}>
        <span className={styles.sectionTitle}>Motion Source</span>
        <select
          value={activeSourceId}
          onChange={(e) => setChosenSourceId(e.target.value)}
          className={styles.fontSelect}
        >
          {videoLayers.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} {l.id === primarySelected ? '(Selected)' : ''}
            </option>
          ))}
        </select>
      </div>

      <TrackMotionSection nodeId={activeSourceId} />
    </div>
  );
}
