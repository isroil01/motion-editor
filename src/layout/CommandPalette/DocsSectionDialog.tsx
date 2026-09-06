/**
 * Where a `?` palette result lands: the picked section of the doc, rendered
 * in a dialog. Not a side panel — the docs are reference material read once
 * and dismissed, and a panel would need a dock slot, a registration and a
 * menu entry for something a user reaches through the palette anyway.
 */

import ReactMarkdown from 'react-markdown';
import { openModal } from '@stores/modalStore';
import type { DocSection } from './docsIndex';
import styles from './DocsSectionDialog.module.css';

export function openDocSection(section: DocSection): void {
  const heading = '#'.repeat(Math.min(6, section.level)) + ' ' + section.heading;
  openModal({
    title: section.title,
    description: section.level === 1 ? undefined : section.heading,
    size: 'lg',
    render: () => (
      <div className={styles.body}>
        <ReactMarkdown>{`${heading}\n\n${section.body || '_This section has no body text._'}`}</ReactMarkdown>
        <p className={styles.source}>{section.file}</p>
      </div>
    ),
  });
}
