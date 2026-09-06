/**
 * Vite's `?raw` import suffix → a short text stub.
 *
 * `?raw` is a Vite loader feature with no CommonJS equivalent, so a module
 * that reads a file's text at build time (the changelog, a shader source)
 * fails to resolve under Jest and takes its whole importer down with it.
 * Tests that care about the real text should read the file themselves.
 */
module.exports = '# Stub\n\nRaw text is not loaded in tests.\n';
