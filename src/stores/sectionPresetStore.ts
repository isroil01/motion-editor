/**
 * Section presets — a saved snapshot of one inspector section's values
 * (a Transform, a text style, a fill-and-stroke, a material), applied to any
 * later layer with one pick.
 *
 * A preference-class thing, not document content: "my house lower-third
 * type style" is something you carry between projects, which is exactly the
 * argument `libraryFavorites` makes for living outside the file. Persisted in
 * localStorage under its own key so the preference blob does not grow a
 * nested store; the backend is swappable the same way the preference store's
 * is.
 */

import { create } from 'zustand';

export type PresetValue = number | string | boolean;
export type PresetValues = Readonly<Record<string, PresetValue>>;

export interface SectionPreset {
  id: string;
  name: string;
  values: PresetValues;
  createdAt: number;
}

interface SectionPresetState {
  /** section id → its presets, oldest first. */
  presets: Readonly<Record<string, ReadonlyArray<SectionPreset>>>;
  save: (sectionId: string, name: string, values: PresetValues) => SectionPreset;
  remove: (sectionId: string, presetId: string) => void;
  rename: (sectionId: string, presetId: string, name: string) => void;
  list: (sectionId: string) => ReadonlyArray<SectionPreset>;
  replaceAll: (presets: Record<string, ReadonlyArray<SectionPreset>>) => void;
}

export const SECTION_PRESETS_KEY = 'motion-editor.sectionPresets.v1';

export interface SectionPresetBackend {
  read(): Record<string, ReadonlyArray<SectionPreset>> | null;
  write(v: Record<string, ReadonlyArray<SectionPreset>>): void;
}

const localBackend: SectionPresetBackend = {
  read() {
    try {
      const raw = globalThis.localStorage?.getItem(SECTION_PRESETS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, ReadonlyArray<SectionPreset>>) : null;
    } catch {
      return null;
    }
  },
  write(v) {
    try {
      globalThis.localStorage?.setItem(SECTION_PRESETS_KEY, JSON.stringify(v));
    } catch {
      /* quota / blocked — presets are a convenience */
    }
  },
};

let backend: SectionPresetBackend = localBackend;

export function setSectionPresetBackend(b: SectionPresetBackend): void {
  backend = b;
  useSectionPresetStore.setState({ presets: b.read() ?? {} });
}

let seq = 0;
function presetId(): string {
  seq += 1;
  return `sp_${Date.now().toString(36)}_${seq}`;
}

export const useSectionPresetStore = create<SectionPresetState>((set, get) => ({
  presets: backend.read() ?? {},

  save: (sectionId, name, values) => {
    const preset: SectionPreset = {
      id: presetId(),
      name: name.trim() || 'Preset',
      values: { ...values },
      createdAt: Date.now(),
    };
    const next = { ...get().presets, [sectionId]: [...(get().presets[sectionId] ?? []), preset] };
    set({ presets: next });
    backend.write(next);
    return preset;
  },

  remove: (sectionId, id) => {
    const list = (get().presets[sectionId] ?? []).filter((p) => p.id !== id);
    const next = { ...get().presets, [sectionId]: list };
    set({ presets: next });
    backend.write(next);
  },

  rename: (sectionId, id, name) => {
    const list = (get().presets[sectionId] ?? []).map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p));
    const next = { ...get().presets, [sectionId]: list };
    set({ presets: next });
    backend.write(next);
  },

  list: (sectionId) => get().presets[sectionId] ?? [],

  replaceAll: (presets) => {
    set({ presets });
    backend.write(presets);
  },
}));
