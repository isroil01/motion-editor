/**
 * Generative family: paint strokes (deterministic freehand geometry).
 *
 * DEFERRED (need committed binary assets or Canvas2D sim support):
 *   - particles: the particle sim does not rasterise on the Canvas2D oracle
 *     (the emitter falls back to a plain shape body), so it can't be blessed
 *     from Canvas2D yet.
 *   - image-sequence / video: require committed frame assets.
 * Tracked in the Phase 0 coverage task.
 */

import { defineScene, node, type Scene } from '../sceneKit';

const COMP = { width: 360, height: 280, background: '#0c0c12' };
const SIZE = { w: 360, h: 280 };

export const generativeScenes: Scene[] = [
  /*
    Particles v2 (2026-09-09): the GPU is the oracle — the Canvas2D reference
    never rasterised the sim (see the header). One frame at t = 1 s exercises
    the ball emitter (depth + the comp-independent perspective), exact drag,
    the mid-point size/opacity/colour ramps and continuous sub-emission; the
    ballistic form is a pure function of (config, time), so the frame is a
    real golden rather than an eyeball.
  */
  defineScene({
    id: 'particles-v2',
    description: 'Ballistic particles from a sphere emitter with drag, mid-point ramps and continuous sub-emission (GPU oracle).',
    size: SIZE,
    comp: COMP,
    fps: 30,
    frames: [30],
    oracle: 'gpu',
    gpuParity: 'expect-pass',
    build(graph) {
      graph.addNode(node('p', { kind: 'particle', position: { x: 180, y: 150 }, transform: { width: 320, height: 240 } }));
      graph.setParticle('p', {
        emitterType: 'sphere', emitterWidth: 60, emitterHeight: 60, birthRate: 120, maxParticles: 5000,
        lifetime: 1.2, lifetimeRandom: 0.3, speed: 220, speedRandom: 0.4, direction: -90, spread: 70,
        gravityX: 0, gravityY: 260, drag: 1.4, spin: 90, seed: 3, simMode: 'ballistic',
        sizeStart: 3, sizeMid: 14, sizeEnd: 0, midAge: 0.35,
        colorStart: '#fff3b0', colorMid: '#ff8a2a', colorEnd: '#7a1e00',
        opacityStart: 1, opacityMid: 0.9, opacityEnd: 0,
        shape: 'circle', blend: 'add', perspective: 600, speedZ: 120,
        subEmit: 'continuous', subRate: 6, subLifetime: 0.4, subSpeed: 40, subSizeScale: 0.4,
      });
    },
  }),
  defineScene({
    id: 'paint-strokes',
    description: 'Freehand paint strokes on a layer.',
    size: SIZE,
    comp: COMP,
    fps: 30,
    frames: [0],
    build(graph) {
      graph.addNode(node('canvas', { kind: 'shape', position: { x: 180, y: 140 }, transform: { width: 300, height: 220, shapeType: 'rect' }, style: { fill: '#1a2233' } }));
      graph.setPaint('canvas', {
        strokes: [
          { id: 'p1', points: [{ x: -110, y: 40 }, { x: -40, y: -50 }, { x: 30, y: 40 }, { x: 110, y: -50 }], color: '#ff7ad0', size: 14, opacity: 1, hardness: 1, mode: 'paint' },
          { id: 'p2', points: [{ x: -110, y: -10 }, { x: 110, y: -10 }], color: '#7affd0', size: 8, opacity: 1, hardness: 1, mode: 'paint' },
        ],
      });
    },
  }),
];
