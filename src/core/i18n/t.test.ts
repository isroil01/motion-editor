import { t, setCatalogue } from './t';

afterEach(() => setCatalogue({}));

describe('t()', () => {
  it('renders the fallback while there is no catalogue', () => {
    expect(t('export.start', 'Start export')).toBe('Start export');
  });

  it('renders the key itself when there is no fallback either', () => {
    expect(t('export.start')).toBe('export.start');
  });

  it('interpolates {var} placeholders', () => {
    expect(t('assets.count', '{n} assets', { n: 12 })).toBe('12 assets');
    expect(t('rename.prompt', 'Rename "{name}"?', { name: 'Layer 1' })).toBe('Rename "Layer 1"?');
  });

  it('leaves an unknown placeholder as written so the typo is visible', () => {
    expect(t('k', 'Hello {nmae}', { name: 'x' })).toBe('Hello {nmae}');
  });

  it('prefers the catalogue over the fallback once one is loaded', () => {
    setCatalogue({ 'export.start': 'Export starten' });
    expect(t('export.start', 'Start export')).toBe('Export starten');
  });
});
