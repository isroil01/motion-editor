/**
 * The `?` docs index: heading parsing and the label the palette searches.
 */

import { buildDocsIndex, docNameFromPath, parseDocSections, sectionLabel } from './docsIndex';
import { parseQuery } from './paletteSearch';

const CLI = [
  '# CLI',
  '',
  'Intro paragraph.',
  '',
  '## Rendering',
  '',
  'Use `premation render`.',
  '',
  '```sh',
  '# not a heading',
  'premation render in.motion',
  '```',
  '',
  '### Flags',
  '',
  '--fps',
  '',
  '## Captions',
  '',
  'Captions body.',
].join('\n');

describe('docsIndex', () => {
  it('names a doc from its file stem', () => {
    expect(docNameFromPath('docs/EDITOR_REFERENCE.md')).toBe('Editor Reference');
    expect(docNameFromPath('docs/CLI.md')).toBe('CLI');
    expect(docNameFromPath('docs/3d-layer-model.md')).toBe('3d Layer Model');
  });

  it('splits on headings, skipping fenced code, and scopes bodies to the next peer heading', () => {
    const sections = parseDocSections('docs/CLI.md', CLI);
    expect(sections.map((s) => [s.level, s.heading])).toEqual([
      [1, 'CLI'],
      [2, 'Rendering'],
      [3, 'Flags'],
      [2, 'Captions'],
    ]);
    const rendering = sections[1]!;
    // The h3 under it is part of its body; the next h2 is not.
    expect(rendering.body).toContain('### Flags');
    expect(rendering.body).toContain('# not a heading');
    expect(rendering.body).not.toContain('Captions body');
    expect(sections[3]!.body).toBe('Captions body.');
    expect(sections.every((s) => s.title === 'CLI')).toBe(true);
  });

  it('strips NUL bytes and labels sections as Title › Heading', () => {
    const [top, sub] = parseDocSections('docs/X.md', '# Ti\0tle\n\n## Se\0ction\n');
    expect(top!.heading).toBe('Title');
    expect(sectionLabel(top!)).toBe('Title');
    expect(sectionLabel(sub!)).toBe('Title › Section');
  });

  it('indexes files in a stable order with unique ids', () => {
    const index = buildDocsIndex({ 'docs/B.md': '# B\n## b1', 'docs/A.md': '# A' });
    expect(index.map((s) => s.id)).toEqual(['docs/A.md#0', 'docs/B.md#0', 'docs/B.md#1']);
  });

  it('is reached through the ? prefix', () => {
    expect(parseQuery('?render')).toEqual({ mode: 'help', term: 'render' });
    expect(parseQuery('?')).toEqual({ mode: 'help', term: '' });
  });
});
