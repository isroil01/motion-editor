/**
 * Motion blur samples the shutter BETWEEN frames, so the clip map it samples
 * through must not round.
 *
 * A layer's clip map answers "which source frame is this timeline frame", and
 * it rounds — a frame is what footage has. Shutter samples ask a different
 * question ("where was this layer 1/120 s ago"), and rounded, every sample
 * inside the frame came back as the same instant: N identical draws, no smear.
 * Every layer in the app has a bar, so in the app motion blur did nothing at
 * all, while these unit tests — whose scenes have no bars — blurred perfectly.
 *
 * The bar still decides WHICH clip is live by whole frames; only the position
 * inside the source keeps its fraction (`subRemapOf`).
 */

import SceneGraph from '@core/scene/SceneGraph';
import { AnimationEngine } from '@motion/animation';
import type { SceneNode } from '@core/types';
import { SCENE_KIND_PROP } from '@core/scene/seedDefaultScene';

const FPS = 30;
/** The bar: 3 s long, starting at comp 0, source in at frame 0 (the common case). */
const BAR = {
  id: 'bar',
  isActiveAt: (frame: number) => frame >= 0 && frame < 90,
  clip: {
    start: 0,
    duration: 90,
    sourceIn: 0,
    sourceDuration: 90,
    sourceFrameAt: (frame: number) => frame,
  },
};

jest.mock('@core/timeline/TimelineController', () => ({
  getTimelineController: () => ({
    timeline: { getFrameRate: () => ({ fps: FPS }) },
    getLayersForNode: (id: string) => (id === 'box' ? [BAR] : []),
  }),
  compToKeyframeTime: (_id: string, tt: number) => tt,
}));

const { buildSnapshot } = require('./buildSnapshot') as typeof import('./buildSnapshot');

const IDENTITY = { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } };
const BLUR = { enabled: true, shutterAngle: 180, shutterPhase: -90, samples: 8, adaptiveSampleLimit: 16, fps: FPS };

function scene(): SceneGraph {
  const g = new SceneGraph();
  g.addNode({
    id: 'root', name: 'root', parent: null, children: [], visible: true, locked: false, transform: IDENTITY,
    components: [{ id: 'root_m', type: 'group', props: { [SCENE_KIND_PROP]: 'group' } }],
  } as unknown as SceneNode);
  g.addChild('root', {
    id: 'box', name: 'box', parent: 'root', children: [], visible: true, locked: false, transform: IDENTITY,
    components: [
      { id: 'box_t', type: 'Transform', props: { [SCENE_KIND_PROP]: 'shape', x: 400, y: 300, width: 100, height: 100 } },
      { id: 'box_s', type: 'Style', props: { opacity: 100, fill: '#ffffff' } },
      { id: 'box_fx', type: 'fx', props: { motionBlur: true } },
    ],
  } as never);
  return g;
}

function samplesAt(t: number): number[] {
  const anim = new AnimationEngine();
  // 900 px/s — 30 px per frame, so half a frame of shutter spans 15 px.
  anim.setKeyframes('box', 'x', [
    { t: 0, value: 100, easing: 'linear' }, { t: 1, value: 1000, easing: 'linear' },
  ] as never);
  const snap = buildSnapshot(scene(), anim, t, undefined, undefined, undefined, BLUR, {
    width: 800, height: 600, background: '#000000', rootId: 'root',
  } as never);
  return (snap.layers.find((l) => l.id === 'box')!.motionSamples ?? []).map((s) => s.x);
}

describe('motion blur through a layer bar', () => {
  it('moves between shutter samples — the bar must not round them into one pose', () => {
    const xs = samplesAt(0.5);
    expect(xs.length).toBeGreaterThan(1);
    const spread = Math.max(...xs) - Math.min(...xs);
    // A 180° shutter is half a frame: 900 px/s ÷ 30 fps ÷ 2 = 15 px of travel.
    expect(spread).toBeGreaterThan(10);
    expect(spread).toBeLessThan(20);
    // And it straddles the frame's own pose.
    const still = 100 + 900 * 0.5;
    expect(Math.min(...xs)).toBeLessThan(still);
    expect(Math.max(...xs)).toBeGreaterThan(still);
  });

  it('blurs the same way off a whole frame as on one', () => {
    const on = samplesAt(0.5); // frame 15 exactly
    const off = samplesAt(0.5 + 1 / (FPS * 3)); // a third of a frame later
    const spread = (v: number[]): number => Math.max(...v) - Math.min(...v);
    expect(spread(off)).toBeGreaterThan(10);
    expect(Math.abs(spread(off) - spread(on))).toBeLessThan(2);
    // The later frame is further along the move.
    expect(Math.min(...off)).toBeGreaterThan(Math.min(...on));
  });
});
