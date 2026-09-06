/**
 * What's New — the changelog, in the app.
 *
 * Opens by itself once per version (see `whatsNew.ts` for the rule) and from
 * Help ▸ What's New at any time. The text is `CHANGELOG.md` at the repo root,
 * bundled at build time; there is no network and no second copy of the notes.
 */

import ReactMarkdown from 'react-markdown';
import { Button } from '@components/Button';
import { DialogFooter } from '@components/Modal';
import { openModal, useModalStore } from '@stores/modalStore';
import { CHANGELOG_MARKDOWN } from './changelogText';
import { APP_VERSION, readLastSeenVersion, shouldShowWhatsNew, stampSeenVersion } from './whatsNew';
import styles from './WhatsNewDialog.module.css';

const MODAL_ID = 'whats-new';

export function openWhatsNew(): void {
  stampSeenVersion();
  openModal({
    id: MODAL_ID,
    title: "What's new",
    description: `Premation ${APP_VERSION}`,
    size: 'md',
    render: () => (
      <div className={styles.body}>
        <ReactMarkdown>{CHANGELOG_MARKDOWN}</ReactMarkdown>
      </div>
    ),
    footer: (close) => (
      <DialogFooter
        note={<span className={styles.version}>CHANGELOG.md</span>}
        primary={<Button variant="primary" onClick={close}>Got it</Button>}
      />
    ),
    primaryAction: (close) => close(),
  });
}

let checked = false;

/**
 * Open the dialog if this version has not been seen. Called once from the
 * modal host after the editor mounts; safe to call again (no-op).
 */
export function maybeOpenWhatsNew(): void {
  if (checked) return;
  checked = true;
  if (!shouldShowWhatsNew(readLastSeenVersion(), APP_VERSION)) {
    // A fresh profile gets stamped so the NEXT release is the first it hears about.
    if (!readLastSeenVersion()) stampSeenVersion();
    return;
  }
  // Not over another dialog (the recovery offer, the start screen's modals).
  if (useModalStore.getState().stack.length > 0) return;
  openWhatsNew();
}
