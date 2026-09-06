/**
 * Section presets are a PREFERENCE, not document content — "my house
 * lower-third type style" travels between projects the way library
 * favourites do. That decision is what these tests actually hold: the store
 * writes through to its backend on every mutation (so a preset survives a
 * reload) and is namespaced per section (so a Transform preset can never be
 * offered as a Material one).
 */

import {
  useSectionPresetStore,
  setSectionPresetBackend,
  SECTION_PRESETS_KEY,
  type SectionPreset,
  type SectionPresetBackend,
} from './sectionPresetStore';

/** An in-memory stand-in for localStorage, so a test can watch the writes. */
function memoryBackend(seed: Record<string, ReadonlyArray<SectionPreset>> = {}): SectionPresetBackend & {
  writes: number;
  value: Record<string, ReadonlyArray<SectionPreset>>;
} {
  const b = {
    value: { ...seed },
    writes: 0,
    read: () => b.value,
    write: (v: Record<string, ReadonlyArray<SectionPreset>>) => {
      b.value = v;
      b.writes += 1;
    },
  };
  return b;
}

beforeEach(() => {
  setSectionPresetBackend(memoryBackend());
});

describe('save', () => {
  it('appends to the section`s list and returns the new preset', () => {
    const p = useSectionPresetStore.getState().save('transform', 'Centered', { x: 0, y: 0 });
    expect(p.name).toBe('Centered');
    expect(p.values).toEqual({ x: 0, y: 0 });
    expect(useSectionPresetStore.getState().list('transform')).toEqual([p]);
  });

  it('keeps sections apart — a Transform preset is not a Material one', () => {
    const store = useSectionPresetStore.getState();
    store.save('transform', 'A', { x: 1 });
    store.save('material', 'B', { roughness: 0.5 });
    expect(useSectionPresetStore.getState().list('transform').map((p) => p.name)).toEqual(['A']);
    expect(useSectionPresetStore.getState().list('material').map((p) => p.name)).toEqual(['B']);
  });

  it('gives an unnamed preset a name rather than an empty label', () => {
    expect(useSectionPresetStore.getState().save('text', '   ', {}).name).toBe('Preset');
  });

  it('copies the values so a later mutation of the caller`s object cannot reach the store', () => {
    const values: Record<string, number> = { x: 1 };
    const p = useSectionPresetStore.getState().save('transform', 'Snap', values);
    values.x = 999;
    expect(p.values).toEqual({ x: 1 });
  });

  it('mints distinct ids for presets saved in the same millisecond', () => {
    const store = useSectionPresetStore.getState();
    const ids = [store.save('transform', 'a', {}).id, store.save('transform', 'b', {}).id];
    expect(new Set(ids).size).toBe(2);
  });

  it('is oldest-first, which is the order the menu lists them in', () => {
    const store = useSectionPresetStore.getState();
    store.save('transform', 'first', {});
    store.save('transform', 'second', {});
    expect(useSectionPresetStore.getState().list('transform').map((p) => p.name)).toEqual(['first', 'second']);
  });
});

describe('remove and rename', () => {
  it('removes only the named preset', () => {
    const store = useSectionPresetStore.getState();
    const a = store.save('transform', 'a', {});
    store.save('transform', 'b', {});
    useSectionPresetStore.getState().remove('transform', a.id);
    expect(useSectionPresetStore.getState().list('transform').map((p) => p.name)).toEqual(['b']);
  });

  it('renames in place', () => {
    const p = useSectionPresetStore.getState().save('text', 'Old', {});
    useSectionPresetStore.getState().rename('text', p.id, 'New');
    expect(useSectionPresetStore.getState().list('text')[0]?.name).toBe('New');
  });

  it('keeps the old name rather than accepting a blank one', () => {
    const p = useSectionPresetStore.getState().save('text', 'Keep', {});
    useSectionPresetStore.getState().rename('text', p.id, '  ');
    expect(useSectionPresetStore.getState().list('text')[0]?.name).toBe('Keep');
  });

  it('is a no-op on an id that is not there', () => {
    useSectionPresetStore.getState().save('text', 'Keep', {});
    useSectionPresetStore.getState().remove('text', 'nope');
    expect(useSectionPresetStore.getState().list('text')).toHaveLength(1);
  });
});

describe('persistence', () => {
  it('writes through on every mutation', () => {
    const b = memoryBackend();
    setSectionPresetBackend(b);
    const before = b.writes;
    const store = useSectionPresetStore.getState();
    const p = store.save('transform', 'a', { x: 1 });
    useSectionPresetStore.getState().rename('transform', p.id, 'b');
    useSectionPresetStore.getState().remove('transform', p.id);
    expect(b.writes).toBe(before + 3);
  });

  it('loads what the backend already holds', () => {
    const seeded: SectionPreset = { id: 'sp_seed', name: 'Seeded', values: { x: 5 }, createdAt: 0 };
    setSectionPresetBackend(memoryBackend({ appearance: [seeded] }));
    expect(useSectionPresetStore.getState().list('appearance')).toEqual([seeded]);
  });

  it('starts empty when the backend has nothing, instead of throwing', () => {
    setSectionPresetBackend({ read: () => null, write: () => {} });
    expect(useSectionPresetStore.getState().list('transform')).toEqual([]);
  });

  it('keeps its own storage key, so it cannot collide with the preference blob', () => {
    expect(SECTION_PRESETS_KEY).toBe('motion-editor.sectionPresets.v1');
  });
});
