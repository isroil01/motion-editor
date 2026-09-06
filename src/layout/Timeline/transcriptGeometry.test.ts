/**
 * The transcript lane's TIME MAPPING.
 *
 * A word chip that is not laid out with the ruler's own `leftOffset + t * pps`
 * looks right at the default zoom and drifts further from the picture the
 * further you zoom in — which is exactly when someone is using the lane to cut
 * to a syllable. So the mapping is asserted against that formula literally,
 * rather than against a number that happens to be what the code produces.
 */

import type { TranscriptWord } from '@core/captions/transcriptEdit';
import { TIMELINE_LEFT_OFFSET } from './Timeline';
import { layoutWords, MIN_WORD_WIDTH_PX, selectedSpan } from './transcriptGeometry';

const word = (id: string, start: number, end: number, estimated = false): TranscriptWord => ({
  id,
  text: id,
  start,
  end,
  cueIndex: 0,
  estimated,
});

const WORDS: TranscriptWord[] = [
  word('a', 0.5, 0.8),
  word('b', 0.9, 1.4, true),
  word('c', 5.0, 5.4),
];

describe('layoutWords', () => {
  it('places a chip at the ruler’s own x for its start time', () => {
    const pps = 120;
    const [a] = layoutWords(WORDS, { pps, leftOffset: TIMELINE_LEFT_OFFSET, from: 0, to: 10 });
    expect(a!.left).toBeCloseTo(TIMELINE_LEFT_OFFSET + 0.5 * pps, 6);
    expect(a!.width).toBeCloseTo((0.8 - 0.5) * pps, 6);
  });

  it('keeps the mapping exact at extreme zoom', () => {
    for (const pps of [4, 80, 800]) {
      const [, b] = layoutWords(WORDS, { pps, leftOffset: 8, from: 0, to: 10 });
      expect(b!.left).toBeCloseTo(8 + 0.9 * pps, 6);
    }
  });

  it('seeks to a word’s START, not its middle', () => {
    // A mid-word playhead cuts the first syllable off the preview, which is
    // the one thing "take me to that word" must not do.
    const [a] = layoutWords(WORDS, { pps: 100, leftOffset: 0, from: 0, to: 10 });
    expect(a!.time).toBe(0.5);
  });

  it('gives a very short word a hittable minimum width', () => {
    const tiny = [word('t', 1, 1.001)];
    const [t] = layoutWords(tiny, { pps: 10, leftOffset: 0, from: 0, to: 10 });
    expect(t!.width).toBe(MIN_WORD_WIDTH_PX);
  });

  it('culls to the visible window so a two-hour interview costs a few dozen chips', () => {
    const boxes = layoutWords(WORDS, { pps: 80, leftOffset: 0, from: 0, to: 2 });
    expect(boxes.map((b) => b.id)).toEqual(['a', 'b']);
  });

  it('keeps a word that only OVERLAPS the window edge', () => {
    // Half a word on screen is still a word on screen; dropping it leaves a
    // gap in the lane exactly where the user is scrolling to.
    const boxes = layoutWords(WORDS, { pps: 80, leftOffset: 0, from: 1.0, to: 1.1 });
    expect(boxes.map((b) => b.id)).toEqual(['b']);
  });

  it('carries the estimated flag through, rather than hiding it', () => {
    const boxes = layoutWords(WORDS, { pps: 80, leftOffset: 0, from: 0, to: 10 });
    expect(boxes.find((b) => b.id === 'b')!.estimated).toBe(true);
    expect(boxes.find((b) => b.id === 'a')!.estimated).toBe(false);
  });
});

describe('selectedSpan', () => {
  it('spans from the first selected word’s start to the last one’s end', () => {
    expect(selectedSpan(WORDS, new Set(['a', 'c']))).toEqual({ start: 0.5, end: 5.4 });
  });

  it('is null with nothing selected, so the action can hide', () => {
    expect(selectedSpan(WORDS, new Set())).toBeNull();
  });

  it('ignores ids that are not in this transcript', () => {
    expect(selectedSpan(WORDS, new Set(['ghost']))).toBeNull();
  });
});
