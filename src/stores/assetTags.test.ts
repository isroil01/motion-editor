/**
 * Tags have to SURVIVE. They are the user's own organisation of the library —
 * "b-roll", "client approved" — and neither IndexedDB nor the cloud record
 * carries them, so if `setTags` only wrote to the zustand slice they would
 * live exactly as long as the tab did.
 *
 * The store persists them into one `assetOrganisation` map (alongside the
 * colour label, import date and origin path) and re-applies that map after
 * every load. These tests pin the WRITE half — that a tag edit reaches
 * localStorage, that clearing removes it rather than storing an empty list,
 * and that an asset with nothing to say does not take up a row.
 */

import { useAssetStore, type ImportedAsset } from './assetStore';

const KEY = 'motion-editor.assetOrganisation.v1';

const asset = (id: string, extra: Partial<ImportedAsset> = {}): ImportedAsset =>
  ({
    id,
    name: `${id}.mp4`,
    type: 'video',
    src: `blob:${id}`,
    size: 1000,
    folderId: null,
    ...extra,
  }) as ImportedAsset;

const stored = (): Record<string, { tags?: string[]; label?: string }> =>
  JSON.parse(localStorage.getItem(KEY) ?? '{}');

beforeEach(() => {
  localStorage.clear();
  useAssetStore.setState({ assets: [asset('a'), asset('b')] });
});

afterEach(() => {
  useAssetStore.setState({ assets: [] });
  localStorage.clear();
});

it('writes a tag edit through to storage, not only to the slice', () => {
  useAssetStore.getState().setTags('a', ['b-roll', 'outdoor']);

  expect(useAssetStore.getState().assets.find((x) => x.id === 'a')?.tags).toEqual(['b-roll', 'outdoor']);
  expect(stored().a?.tags).toEqual(['b-roll', 'outdoor']);
});

it('leaves untagged assets out of the map entirely', () => {
  useAssetStore.getState().setTags('a', ['b-roll']);
  // 'b' has no tags, no label, no date and no path — an absent row, not an
  // empty one. The map is read back into every asset on load, so a row per
  // asset would grow without bound for no information.
  expect(Object.keys(stored())).toEqual(['a']);
});

it('clearing the last tag removes the tag, and the row with it', () => {
  useAssetStore.getState().setTags('a', ['b-roll']);
  useAssetStore.getState().setTags('a', []);

  expect(useAssetStore.getState().assets.find((x) => x.id === 'a')?.tags).toBeUndefined();
  expect(stored().a).toBeUndefined();
});

it('keeps the colour label and the tags in the same row', () => {
  useAssetStore.getState().setTags('a', ['b-roll']);
  useAssetStore.getState().setLabel(['a'], 'coral');

  expect(stored().a).toEqual({ tags: ['b-roll'], label: 'coral' });
});

it('tags one asset without disturbing its neighbours', () => {
  useAssetStore.getState().setTags('a', ['b-roll']);
  useAssetStore.getState().setTags('b', ['music']);
  useAssetStore.getState().setTags('a', ['b-roll', 'approved']);

  expect(stored().b?.tags).toEqual(['music']);
  expect(stored().a?.tags).toEqual(['b-roll', 'approved']);
});
