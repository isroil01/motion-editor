/**
 * The `?` prefix: a heading index over `docs/*.md`, built from raw markdown.
 *
 * Pure. The loader that actually reads the files lives in `docsGlob.ts` (it
 * uses `import.meta.glob`, which Jest cannot parse); everything here takes
 * strings and returns entries, so the parsing and the search are testable.
 *
 * One entry per heading. `body` is the text between this heading and the next
 * heading of the same or a higher level — the section a reader would expect
 * to open when they pick "CLI › Rendering" out of the list.
 */

export interface DocSection {
  /** `docs/CLI.md` → `CLI`. */
  doc: string;
  /** File path as the glob reported it, for the title and for debugging. */
  file: string;
  /** Heading text with the `#`s stripped. */
  heading: string;
  /** 1 = `#`, 2 = `##`, … */
  level: number;
  /** The document title (first `#` heading) or the file stem when absent. */
  title: string;
  /** Markdown of the section, heading line excluded. */
  body: string;
  /** Stable id: `file#index`. */
  id: string;
}

/** `docs/EDITOR_REFERENCE.md` → `Editor Reference`. */
export function docNameFromPath(file: string): string {
  const stem = (file.split('/').pop() ?? file).replace(/\.md$/i, '');
  return stem
    .split(/[_-]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 && w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

const HEADING = /^(#{1,4})\s+(.+?)\s*#*\s*$/;

/**
 * Split one markdown file into heading-delimited sections.
 *
 * Fenced code blocks are skipped for heading detection — a `# comment` inside
 * a ``` fence is not a heading. NUL bytes (one doc in the repo has them) are
 * stripped so they cannot poison a search string.
 */
export function parseDocSections(file: string, markdown: string): DocSection[] {
  const text = markdown.replace(/\0/g, '');
  const lines = text.split(/\r?\n/);
  const doc = docNameFromPath(file);

  interface Open { heading: string; level: number; start: number }
  const heads: Open[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (/^\s*(```|~~~)/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = HEADING.exec(line);
    if (!m) continue;
    heads.push({ heading: (m[2] ?? '').trim(), level: (m[1] ?? '#').length, start: i });
  }

  const title = heads.find((h) => h.level === 1)?.heading ?? doc;
  const out: DocSection[] = [];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i]!;
    // The section ends at the next heading of the same or higher level.
    let end = lines.length;
    for (let j = i + 1; j < heads.length; j++) {
      if (heads[j]!.level <= h.level) { end = heads[j]!.start; break; }
    }
    const body = lines.slice(h.start + 1, end).join('\n').trim();
    out.push({ doc, file, heading: h.heading, level: h.level, title, body, id: `${file}#${i}` });
  }
  return out;
}

/** Index every file. `files` is path → markdown. */
export function buildDocsIndex(files: Readonly<Record<string, string>>): DocSection[] {
  return Object.keys(files)
    .sort()
    .flatMap((file) => parseDocSections(file, files[file] ?? ''));
}

/** What the palette matches against and shows: `Title › Heading`. */
export function sectionLabel(s: DocSection): string {
  return s.level === 1 ? s.title : `${s.title} › ${s.heading}`;
}
