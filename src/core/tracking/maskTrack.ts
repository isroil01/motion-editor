/**
 * Mask tracking — rotoscoping's first honest step: every vertex of a layer's
 * mask becomes a track point, and the tracked motion becomes mask keyframes.
 *
 * This rides the EXISTING mask-animation system (`fx.maskAnim`: an array of
 * full `MaskKeyframe` snapshots, linearly interpolated, index-paired — see
 * mask.ts), not the animation engine: masks have no PropPath and the
 * renderer reads them exclusively through `readNodeMaskAt`. One keyframe per
 * tracked comp frame is dense, but dense is what measurement produces —
 * thinning is a curve-fit pass this deliberately does not invent.
 *
 * Vertices are tracked as a party in ONE decode walk (trackVideoLayerPoints),
 * so a 20-point roto costs the same decoding as a 1-point track. Bezier
 * handles travel RIGIDLY with their vertex (same delta applied to in/out):
 * a per-vertex tracker measures translation, and pretending it measured
 * curvature would manufacture wobble. A vertex that gets lost mid-way
 * FREEZES at its last tracked position while the others continue — the
 * index-paired interpolation needs every keyframe to carry every point.
 *
 * Past MAX_VERTICES the party is SAMPLED rather than refused: at most that
 * many vertices, evenly spaced by arc length, are tracked, and each other
 * vertex moves with its two nearest tracked neighbours along the path (see
 * maskVertexSampling.ts). The path keeps every vertex. Within the cap every
 * vertex is tracked and the write is the same as it always was.
 *
 * Like every other mask write in the app, this does not create an undo
 * entry — mask state lives on scene-graph fx props, outside the animation
 * history's diff. Re-running the track overwrites the tracked range;
 * keyframes outside the range survive (the Motion Sketch splice rule).
 */

import { getEventBus } from '@core/events/EventBus';
import defaultSceneGraph from '@core/scene/DefaultSceneGraph';
import { bumpScene } from '@stores/sceneStore';
import { compToKeyframeTime } from '@core/timeline/TimelineController';
import { readGeometry } from '@core/workspace/geometry';
import {
  readNodeMask,
  readNodeMaskAnim,
  readNodeMaskAt,
  type LayerMask,
  type MaskKeyframe,
  type MaskPoint,
} from '@core/effects/mask';
import { sourceDisplaySize } from './trackerSource';
import { trackVideoLayerPoints, type CompTrackSample } from './trackVideoLayer';
import { blendVertexDeltas, sampleMaskVertices, MAX_TRACKED_VERTICES } from './maskVertexSampling';

/** More vertices than this is a shape, not a set of trackable features — sampled, not refused. */
const MAX_VERTICES = MAX_TRACKED_VERTICES;

export interface MaskTrackRequest {
  nodeId: string;
  startCompTime: number;
  endCompTime: number;
  fps: number;
  featureHalf: number;
  searchHalf: number;
  onProgress?: (fraction: number) => boolean | void;
}

export interface MaskTrackResult {
  /** Mask keyframes written. */
  keyframes: number;
  /** Vertices across all paths — every one of them gets keyframes. */
  vertices: number;
  /** Vertices actually handed to the tracker (≤ MAX_VERTICES); the rest are interpolated. */
  sampled: number;
  status: 'completed' | 'lost' | 'cancelled';
}

interface VertexRef {
  pathIndex: number;
  pointIndex: number;
}

export async function trackLayerMask(req: MaskTrackRequest): Promise<MaskTrackResult> {
  const node = defaultSceneGraph.getNode(req.nodeId);
  if (!node) throw new Error('Layer is gone.');
  const g = readGeometry(node);
  const src = sourceDisplaySize(req.nodeId);
  if (!g || !src) throw new Error('Layer has no sized video source.');

  // The shape to track is the one VISIBLE at the start time — if the mask is
  // already animated, tracking continues from what the user sees, not from
  // the static rest shape underneath.
  const startLayerT = compToKeyframeTime(req.nodeId, req.startCompTime);
  const base: LayerMask | undefined = readNodeMaskAt(node, startLayerT) ?? readNodeMask(node);
  if (!base || base.paths.length === 0) throw new Error('Layer has no mask to track.');

  // Flatten every path's vertices into one list, in path order.
  const refs: VertexRef[] = [];
  const vertices: Array<{ x: number; y: number }> = [];
  const samplable: Array<{ points: Array<{ x: number; y: number }>; closed: boolean }> = [];
  for (let p = 0; p < base.paths.length; p++) {
    const path = base.paths[p]!;
    const display: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < path.points.length; i++) {
      const pt = path.points[i]!;
      refs.push({ pathIndex: p, pointIndex: i });
      // layer-local (centred) → source display px — the inverse of the
      // trackSampleToComp local step, stated once in applyTrack.ts.
      display.push({
        x: (pt.x / g.width + 0.5) * src.width,
        y: (pt.y / g.height + 0.5) * src.height,
      });
    }
    vertices.push(...display);
    samplable.push({ points: display, closed: path.closed });
  }
  if (vertices.length === 0) throw new Error('The mask has no points.');

  // The tracking party: every vertex within the cap, an arc-length sample of
  // them past it. `points[k]` is the rest position of slot k.
  const sampling = sampleMaskVertices(samplable, MAX_VERTICES);
  const points = sampling.tracked.map((v) => vertices[v]!);

  const result = await trackVideoLayerPoints({
    nodeId: req.nodeId,
    startCompTime: req.startCompTime,
    endCompTime: req.endCompTime,
    fps: req.fps,
    points,
    featureHalf: req.featureHalf,
    searchHalf: req.searchHalf,
    ...(req.onProgress ? { onProgress: req.onProgress } : {}),
  });

  // Sample times: the union of comp times any vertex reached, in order. A
  // vertex missing at a time freezes at its last known place (see header).
  const timeSet = new Set<number>();
  for (const track of result.tracks) for (const s of track) timeSet.add(s.compTime);
  const times = [...timeSet].sort((a, b) => a - b);
  if (times.length < 2) throw new Error('Tracking produced too little motion to keyframe.');

  const byTime: Array<Map<number, CompTrackSample>> = result.tracks.map((track) => {
    const m = new Map<number, CompTrackSample>();
    for (const s of track) m.set(s.compTime, s);
    return m;
  });

  const keyframes: MaskKeyframe[] = [];
  const lastKnown: Array<{ x: number; y: number }> = points.map((p) => ({ ...p }));
  const interpolated = sampling.tracked.length < refs.length;
  for (const compTime of times) {
    // Where every tracked slot is at this time (frozen if it was lost).
    const slotAt: Array<{ x: number; y: number }> = new Array(points.length);
    for (let k = 0; k < points.length; k++) {
      const sample = byTime[k]!.get(compTime);
      const at = sample ? { x: sample.x, y: sample.y } : lastKnown[k]!;
      if (sample) lastKnown[k] = at;
      slotAt[k] = at;
    }
    // Untracked vertices ride their neighbours' deltas (display px).
    const blended = interpolated
      ? blendVertexDeltas(sampling, slotAt.map((at, k) => ({ x: at.x - points[k]!.x, y: at.y - points[k]!.y })))
      : null;
    // Deep-clone the base shape and displace each vertex by its tracked delta.
    const paths = base.paths.map((path) => ({ ...path, points: path.points.map((pt) => ({ ...pt })) }));
    for (let v = 0; v < refs.length; v++) {
      const slot = sampling.slotOf[v]!;
      const at = slot >= 0
        ? slotAt[slot]!
        : { x: vertices[v]!.x + blended![v]!.x, y: vertices[v]!.y + blended![v]!.y };
      const ref = refs[v]!;
      const pt: MaskPoint = paths[ref.pathIndex]!.points[ref.pointIndex]!;
      const lx = (at.x / src.width - 0.5) * g.width;
      const ly = (at.y / src.height - 0.5) * g.height;
      const dx = lx - pt.x;
      const dy = ly - pt.y;
      pt.x += dx;
      pt.y += dy;
      pt.inX += dx;
      pt.inY += dy;
      pt.outX += dx;
      pt.outY += dy;
    }
    keyframes.push({ t: compToKeyframeTime(req.nodeId, compTime), mask: { paths } });
  }

  // Splice into any existing animation: keyframes strictly inside the
  // tracked span are replaced, the rest survive.
  const t0 = keyframes[0]!.t;
  const t1 = keyframes[keyframes.length - 1]!.t;
  const existing = readNodeMaskAnim(node).filter((k) => k.t < t0 - 1e-9 || k.t > t1 + 1e-9);
  const merged = [...existing, ...keyframes].sort((a, b) => a.t - b.t);
  defaultSceneGraph.setMaskAnim(req.nodeId, merged);
  getEventBus().emit('AnimationChanged', { nodeId: req.nodeId });
  bumpScene();

  return { keyframes: keyframes.length, vertices: refs.length, sampled: points.length, status: result.status };
}
