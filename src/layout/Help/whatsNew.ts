/**
 * What's New gating — pure, so the "once per version" rule can be pinned.
 *
 * The rule is deliberately simple: the dialog opens when the running version
 * differs from the one last stamped, and stamps it as soon as it has opened.
 * Not "newer than": a downgrade is a change too, and a person who rolls back
 * deserves to see that the notes changed. An EMPTY stamp — a fresh install,
 * or a profile from before this existed — does NOT open the dialog: the first
 * launch already has a start screen and a tour competing for attention, and
 * "what's new" means nothing to someone with no "old".
 */

import { usePreferenceStore } from '@stores/preferenceStore';
// The version the build was made from; the desktop shell can say the same
// through IPC but this is synchronous and identical in a packaged app.
import pkg from '../../../package.json';

export const APP_VERSION: string = (pkg as { version?: string }).version ?? '0.0.0';

export function shouldShowWhatsNew(lastSeen: string, current: string): boolean {
  if (!current) return false;
  if (!lastSeen) return false;
  return lastSeen !== current;
}

/** Read the stamp; write it after the dialog has opened. */
export function readLastSeenVersion(): string {
  return usePreferenceStore.getState().lastSeenVersion ?? '';
}

export function stampSeenVersion(version: string = APP_VERSION): void {
  usePreferenceStore.getState().set('lastSeenVersion', version);
}

/**
 * The changelog section for one version, so a caller can lead with it.
 * Returns the whole text when the version has no heading of its own.
 */
export function changelogSectionFor(markdown: string, version: string): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s/.test(l) && l.includes(version));
  if (start < 0) return markdown;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}
