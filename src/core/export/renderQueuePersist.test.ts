/**
 * The render queue's on-disk record, round-tripped.
 *
 * `renderQueueStore` decides WHEN to write; these functions decide WHAT is
 * written and how it reads back. Tested without the store, the shell bridge or
 * a staging directory, because the contract is about the JSON: which fields
 * survive a quit, which never may, and what a hand-edited or old-version blob
 * turns into.
 */

import {
  hadFramesInFlight,
  isPersistedJob,
  isPersistedStatus,
  lostFramesMessage,
  parkedStatusFor,
  persistedResumeFrameOf,
  persistedStatusOf,
  toPersistedJob,
  type PersistableJob,
  type PersistedRenderJob,
} from './renderQueuePersist';

const spec = {
  compositionName: 'Hero',
  compositionId: 'comp-1',
  outputPath: 'hero.mp4',
  format: 'mp4' as const,
  width: 1920,
  height: 1080,
  compWidth: 1920,
  compHeight: 1080,
  fps: 30,
  durationSec: 4,
  rangeStartSec: 0,
  rangeEndSec: 4,
  transparent: false,
  background: '#101014',
  quality: 'high' as const,
};

/** A live queue entry, with everything a running job carries. */
function liveJob(over: Partial<PersistableJob & Record<string, unknown>> = {}): PersistableJob {
  return {
    ...spec,
    id: 'rq_1',
    status: 'paused',
    resumeFrame: 40,
    stagingJobId: 'staging-1',
    // Live-only state, which must never reach disk.
    progress: 0.4,
    elapsedMs: 1234,
    error: undefined,
    attention: 'looked at',
    _resume: { render: { totalFrames: 120 }, nextOffset: 40 },
    _adopt: { jobId: 'staging-1', stagedFrames: 40, nextFrame: 40 },
    ...over,
  } as PersistableJob;
}

describe('what is written down', () => {
  it('keeps the spec, the id, the staging dir, the status and the resume frame', () => {
    const p = toPersistedJob(liveJob());
    expect(p).toEqual({
      ...spec,
      id: 'rq_1',
      stagingJobId: 'staging-1',
      status: 'paused',
      resumeFrame: 40,
    });
  });

  it('never writes a live handle, a progress figure or an elapsed time', () => {
    const p = toPersistedJob(liveJob()) as unknown as Record<string, unknown>;
    for (const key of ['progress', 'elapsedMs', 'error', 'attention', '_resume', '_adopt']) {
      expect(p).not.toHaveProperty(key);
    }
    // And it is plain JSON — no functions, no cycles, nothing lost in a
    // stringify/parse, which is the only way it ever travels.
    expect(JSON.parse(JSON.stringify(p))).toEqual(p);
  });

  it('omits a resume frame of zero and a status that is not persistable', () => {
    const p = toPersistedJob(liveJob({ status: 'done', resumeFrame: 0, stagingJobId: undefined }));
    expect(p).not.toHaveProperty('resumeFrame');
    expect(p).not.toHaveProperty('status');
    expect(p).not.toHaveProperty('stagingJobId');
  });

  it('remembers unfinished business and forgets the finished kind', () => {
    for (const s of ['queued', 'rendering', 'paused', 'stopped', 'failed']) expect(isPersistedStatus(s)).toBe(true);
    for (const s of ['done', 'skipped', 'bogus']) expect(isPersistedStatus(s)).toBe(false);
  });
});

describe('what is read back', () => {
  it('round-trips through JSON to the same record', () => {
    const written = toPersistedJob(liveJob());
    const read: unknown = JSON.parse(JSON.stringify(written));
    expect(isPersistedJob(read)).toBe(true);
    expect(read).toEqual(written);
    const p = read as PersistedRenderJob;
    expect(persistedStatusOf(p)).toBe('paused');
    expect(persistedResumeFrameOf(p)).toBe(40);
    expect(parkedStatusFor(p)).toBe('paused');
  });

  it('accepts a blob written before status and resumeFrame existed', () => {
    const old: unknown = { ...spec, id: 'rq_old', stagingJobId: 'staging-9' };
    expect(isPersistedJob(old)).toBe(true);
    const p = old as PersistedRenderJob;
    expect(persistedStatusOf(p)).toBe('queued');
    expect(persistedResumeFrameOf(p)).toBeUndefined();
    expect(hadFramesInFlight(p)).toBe(false);
  });

  it('tolerates a hand-edited status or frame without rejecting the job', () => {
    const p = { ...spec, id: 'rq_x', status: 'sideways', resumeFrame: 'lots' } as unknown as PersistedRenderJob;
    expect(isPersistedJob(p)).toBe(true);
    expect(persistedStatusOf(p)).toBe('queued');
    expect(persistedResumeFrameOf(p)).toBeUndefined();
    expect(persistedResumeFrameOf({ ...p, resumeFrame: 12.9 })).toBe(12);
    expect(persistedResumeFrameOf({ ...p, resumeFrame: -3 })).toBeUndefined();
    expect(persistedResumeFrameOf({ ...p, resumeFrame: Number.NaN })).toBeUndefined();
  });

  it('rejects things that are not jobs at all', () => {
    for (const bad of [null, undefined, 42, 'job', {}, { id: 'x' }, { ...spec }, { ...spec, id: 1 }, { ...spec, id: 'x', width: '1920' }]) {
      expect(isPersistedJob(bad)).toBe(false);
    }
  });
});

describe('what the record means to a restore', () => {
  const rec = (status: PersistedRenderJob['status'], resumeFrame?: number): PersistedRenderJob =>
    ({ ...spec, id: 'rq_1', status, ...(resumeFrame !== undefined ? { resumeFrame } : {}) });

  it('paused, stopped and rendering were all holding (or making) frames; queued and failed were not', () => {
    expect(hadFramesInFlight(rec('paused', 10))).toBe(true);
    expect(hadFramesInFlight(rec('stopped', 10))).toBe(true);
    expect(hadFramesInFlight(rec('rendering'))).toBe(true);
    expect(hadFramesInFlight(rec('queued'))).toBe(false);
    expect(hadFramesInFlight(rec('failed'))).toBe(false);
  });

  it('a user pause comes back paused; everything else parks as stopped, never rendering', () => {
    expect(parkedStatusFor(rec('paused', 10))).toBe('paused');
    expect(parkedStatusFor(rec('stopped', 10))).toBe('stopped');
    expect(parkedStatusFor(rec('rendering'))).toBe('stopped');
    expect(parkedStatusFor(rec('queued'))).toBe('stopped');
  });

  it('says how many frames were lost when it knows, and that it starts over either way', () => {
    expect(lostFramesMessage(rec('paused', 400))).toMatch(/^400 rendered frames from your last session/);
    expect(lostFramesMessage(rec('paused', 1))).toMatch(/^1 rendered frame from/);
    expect(lostFramesMessage(rec('rendering'))).toMatch(/before the app closed/);
    expect(lostFramesMessage(rec('stopped'))).toMatch(/^Its rendered frames/);
    for (const m of [lostFramesMessage(rec('paused', 400)), lostFramesMessage(rec('rendering'))]) {
      expect(m).toMatch(/starts again from the beginning/);
    }
  });
});
