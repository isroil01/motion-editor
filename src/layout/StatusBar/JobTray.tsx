/**
 * JobTray — the running background jobs (render, cache pass, transcription,
 * model download), one compact chip each, in the status bar's right cluster.
 *
 * Reads `uiStore.jobs` directly: each job also drives one progress toast, but
 * a toast is dismissable and a render is not over just because its card is
 * gone. The tray is the persistent view. Only RUNNING jobs are shown; a
 * finished job's outcome is the closing toast's business.
 */

import { Progress } from '@components/Progress';
import { Badge } from '@components/Badge';
import { useUIStore } from '@stores/uiStore';
import styles from './EditorStatusBar.module.css';

const MAX_CHIPS = 2;

export function JobTray(): JSX.Element | null {
  const jobs = useUIStore((s) => s.jobs);
  const running = jobs.filter((j) => j.status === 'running');
  if (running.length === 0) return null;
  const shown = running.slice(0, MAX_CHIPS);
  const more = running.length - shown.length;
  return (
    <div className={styles.tray} role="group" aria-label="Background jobs">
      {shown.map((job) => {
        const indeterminate = job.progress === 'indeterminate';
        const pct = indeterminate ? null : Math.round((job.progress as number) * 100);
        return (
          <div
            key={job.id}
            className={styles.job}
            title={`${job.label}${pct === null ? '' : ` — ${pct}%`}`}
          >
            <span className={styles.jobLabel}>{job.label}</span>
            <Progress
              className={styles.jobBar}
              size="sm"
              value={indeterminate ? 0 : (job.progress as number)}
              indeterminate={indeterminate}
              aria-label={job.label}
            />
            {pct !== null ? <span className={styles.jobPct}>{pct}%</span> : null}
          </div>
        );
      })}
      {more > 0 ? <Badge size="sm" title={`${more} more running`}>+{more}</Badge> : null}
      <span className={styles.dot} aria-hidden>·</span>
    </div>
  );
}
