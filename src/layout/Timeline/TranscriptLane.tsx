/**
 * TranscriptLane — the spoken words, under the ruler, on the timeline's axis.
 *
 * ## What it is for
 *
 * Text editing of video. The Transcript panel already does this as a page of
 * prose, which is the right shape for reading; it is the wrong shape for the
 * question you have while looking at a cut, which is "what is being said HERE".
 * Under the ruler the words line up with the picture, so a click seeks to a
 * word and a shift-click selects the run between two of them.
 *
 * ## What it deliberately does not do
 *
 * It does not own the transcript, the selection, or the edit. All three live in
 * `@layout/Transcript` and `@core/captions`, imported READ-ONLY here — the same
 * store the panel reads, so a run selected in one is selected in the other, and
 * "Delete range" is `deleteSelectedWords`, the panel's own operation. A second
 * implementation of "delete these words" is exactly how two surfaces come to
 * disagree about what a deletion does to the gap it leaves.
 *
 * ## Cost
 *
 * `layoutWords` culls to the visible window before anything reaches the DOM: a
 * two-hour interview is forty thousand words and about sixty chips.
 */

import { memo, useMemo, useState } from 'react';
import { cn } from '@utils/cn';
import { useTranscriptStore } from '@layout/Transcript';
import { idsBetween } from '@core/captions/transcriptEdit';
import { deleteSelectedWords } from '@layout/Transcript/transcriptOps';
import { layoutWords, selectedSpan, TRANSCRIPT_LANE_HEIGHT } from './transcriptGeometry';
import type { TimeWindow } from './visibleWindow';
import styles from './Timeline.module.css';

interface TranscriptLaneProps {
  /** Composition root node id — transcripts are keyed by it. */
  rootId: string;
  pps: number;
  leftOffset: number;
  /** Lane content width, so the strip spans the scrolled area. */
  width: number;
  /** Where the lane's top edge sits inside the ruler stack. */
  top: number;
  window: TimeWindow;
  /** Seek the playhead — the timeline's own scrub callback. */
  onSeek?: (time: number) => void;
}

function TranscriptLaneImpl({
  rootId,
  pps,
  leftOffset,
  width,
  top,
  window: timeWindow,
  onSeek,
}: TranscriptLaneProps): JSX.Element | null {
  const transcript = useTranscriptStore((s) => s.byComp[rootId]);
  const selected = useTranscriptStore((s) => s.selected);
  const anchorId = useTranscriptStore((s) => s.anchorId);
  const select = useTranscriptStore((s) => s.select);
  const setAnchor = useTranscriptStore((s) => s.setAnchor);
  const [busy, setBusy] = useState(false);

  const words = transcript?.words ?? [];
  const boxes = useMemo(
    () => layoutWords(words, { pps, leftOffset, from: timeWindow.t0, to: timeWindow.t1 }),
    [words, pps, leftOffset, timeWindow.t0, timeWindow.t1],
  );
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const span = useMemo(() => selectedSpan(words, selectedSet), [words, selectedSet]);

  if (!transcript) return null;

  return (
    <div
      className={styles.transcriptLane}
      style={{ top, height: TRANSCRIPT_LANE_HEIGHT, width }}
      role="group"
      aria-label="Transcript"
    >
      {boxes.map((box) => (
        <button
          type="button"
          key={box.id}
          className={cn(
            styles.transcriptWord,
            selectedSet.has(box.id) && styles.transcriptWordSelected,
            box.estimated && styles.transcriptWordEstimated,
          )}
          style={{ left: box.left, width: box.width }}
          title={box.estimated ? `${box.text} — timing estimated` : box.text}
          aria-pressed={selectedSet.has(box.id)}
          // Stopped so the press does not scrub the ruler underneath: this
          // lane sits inside the sticky ruler stack, whose pointerdown is the
          // playhead grab.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (e.shiftKey && anchorId) {
              select(idsBetween(words, anchorId, box.id), 'replace');
              return;
            }
            if (e.ctrlKey || e.metaKey) {
              select([box.id], 'toggle');
              setAnchor(box.id);
              return;
            }
            select([box.id], 'replace');
            setAnchor(box.id);
            onSeek?.(box.time);
          }}
        >
          <span className={styles.transcriptWordText}>{box.text}</span>
        </button>
      ))}

      {/* The action sits ON the selection rather than in a toolbar: the run you
          are about to cut is the thing you are looking at, and a button
          somewhere else means checking twice that it means this selection. */}
      {span ? (
        <button
          type="button"
          className={styles.transcriptDelete}
          style={{ left: leftOffset + span.end * pps + 6 }}
          disabled={busy}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setBusy(true);
            void deleteSelectedWords(rootId).finally(() => setBusy(false));
          }}
          title={`Delete ${(span.end - span.start).toFixed(2)}s of time and close the gap`}
        >
          {busy ? 'Deleting…' : `Delete range (${(span.end - span.start).toFixed(2)}s)`}
        </button>
      ) : null}
    </div>
  );
}

export const TranscriptLane = memo(TranscriptLaneImpl);
export default TranscriptLane;
