/**
 * The native (Electron) application menu, generated from `menuModel.ts`.
 *
 * `electron/main.ts` used to hand-maintain ~15 items that were a drifting
 * subset of `APP_MENU` — the labels had already diverged ("Save to Computer…"
 * vs "Save Portable Copy…"). Now the renderer serialises the SAME model the
 * in-app menu bar draws — labels from the registry, chords as Electron
 * accelerators, `visible()` and `checked()` evaluated, submenu tree intact —
 * and sends it over IPC (`setMenuTemplate`); main builds the template from
 * that and keeps only the roles it must own (Cut/Copy/Paste, Quit, the macOS
 * app menu, Check for Updates).
 *
 * Pure and DOM-free so it is unit-tested against the real `APP_MENU`.
 *
 * ENTRIES WITHOUT A COMMAND ID (the workspace presets, which are runtime user
 * data with an `onSelect`) cannot cross IPC as a command. They are given a
 * synthetic id — `menu.action:<group>/<i>/<j>` — that names their PATH in the
 * model; `runNativeMenuAction` walks the same path back to the `onSelect` when
 * the id comes back from main. `Providers`' command dispatcher skips these.
 *
 * ACCELERATORS ARE RESTRICTED to chords with a Ctrl/Cmd/Alt modifier or a
 * function key. A native accelerator fires BEFORE the renderer sees the key —
 * inside text fields too — so a bare `V` or `Tab` in the native menu would
 * eat typing app-wide. Those chords stay renderer-side (ShortcutManager),
 * where `enabled()` can hand them back to the field.
 *
 * `meta` in a `KeyChord` is the app's PRIMARY modifier — `resolveChord` turns
 * it into `ctrl` off macOS at runtime — so it is spelled `Cmd` on darwin and
 * `CmdOrCtrl` elsewhere, never dropped.
 */

import type { KeyChord } from '@app-types/common';
import { asCommandId } from '@app-types/common';
import type { Command } from '@core/commands/Command';
import { visibleItems } from './useAppMenuGroups';
import type { MenuGroupModel, MenuItemModel } from './menuModel';

export interface NativeMenuItemSpec {
  type?: 'separator';
  label?: string;
  /** A registered command id, or a `menu.action:` path id. */
  commandId?: string;
  /** Electron accelerator string, e.g. `CmdOrCtrl+Shift+S`. */
  accelerator?: string;
  /** Present only for toggles. */
  checked?: boolean;
  submenu?: NativeMenuItemSpec[];
}

export interface NativeMenuGroupSpec {
  id: string;
  label: string;
  items: NativeMenuItemSpec[];
}

export const NATIVE_MENU_ACTION_PREFIX = 'menu.action:';

export function isNativeMenuActionId(id: string): boolean {
  return id.startsWith(NATIVE_MENU_ACTION_PREFIX);
}

export type NativePlatform = 'darwin' | 'other';

const KEY_NAMES: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Enter: 'Return',
  Tab: 'Tab',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
};

/**
 * An Electron accelerator for `chord`, or `undefined` when the chord must not
 * be claimed natively (see the module note).
 */
export function toAccelerator(chord: KeyChord, platform: NativePlatform): string | undefined {
  const isFn = /^F\d{1,2}$/.test(chord.key);
  if (!chord.ctrl && !chord.meta && !chord.alt && !isFn) return undefined;
  const parts: string[] = [];
  if (chord.ctrl) parts.push('Ctrl');
  if (chord.meta) parts.push(platform === 'darwin' ? 'Cmd' : 'CmdOrCtrl');
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  const key = KEY_NAMES[chord.key] ?? (chord.key.length === 1 ? chord.key.toUpperCase() : chord.key);
  parts.push(key);
  return parts.join('+');
}

export interface NativeMenuSources {
  /** The registry lookup. */
  lookup: (id: string) => Command | undefined;
  /** The user's rebinds applied — `resolveChord(id, cmd.shortcut, overrides)`. */
  resolveChord: (cmd: Command) => KeyChord | undefined;
  platform: NativePlatform;
}

function resolveChildren(item: MenuItemModel): ReadonlyArray<MenuItemModel> {
  const c = item.children;
  if (!c) return [];
  return typeof c === 'function' ? c() : c;
}

function serialiseItems(
  items: ReadonlyArray<MenuItemModel>,
  path: string,
  src: NativeMenuSources,
): NativeMenuItemSpec[] {
  const out: NativeMenuItemSpec[] = [];
  const kept = visibleItems(items);
  for (let i = 0; i < kept.length; i++) {
    const it = kept[i]!;
    if (it.separator) { out.push({ type: 'separator' }); continue; }
    const here = `${path}/${i}`;
    if (it.children) {
      out.push({ label: it.label ?? '', submenu: serialiseItems(resolveChildren(it), here, src) });
      continue;
    }
    if (it.commandId) {
      const cmd = src.lookup(it.commandId);
      const chord = cmd ? src.resolveChord(cmd) : undefined;
      const accelerator = chord ? toAccelerator(chord, src.platform) : undefined;
      const checked = cmd?.isChecked?.();
      out.push({
        label: it.label ?? cmd?.label ?? it.commandId,
        commandId: it.commandId,
        ...(accelerator ? { accelerator } : {}),
        ...(typeof checked === 'boolean' ? { checked } : {}),
      });
      continue;
    }
    if (it.onSelect) {
      const checked = it.checked?.();
      out.push({
        label: it.label ?? '',
        commandId: `${NATIVE_MENU_ACTION_PREFIX}${here}`,
        ...(typeof checked === 'boolean' ? { checked } : {}),
      });
    }
  }
  // Tidy rules the hidden entries left behind.
  const tidy: NativeMenuItemSpec[] = [];
  for (const it of out) {
    if (it.type === 'separator' && (tidy.length === 0 || tidy[tidy.length - 1]?.type === 'separator')) continue;
    tidy.push(it);
  }
  while (tidy.length > 0 && tidy[tidy.length - 1]?.type === 'separator') tidy.pop();
  return tidy;
}

export function buildNativeMenuTemplate(
  groups: ReadonlyArray<MenuGroupModel>,
  src: NativeMenuSources,
): NativeMenuGroupSpec[] {
  return groups.map((g) => ({ id: g.id, label: g.label, items: serialiseItems(g.items, g.id, src) }));
}

/**
 * Run the `onSelect` a `menu.action:` id points at. Walks the same
 * `visibleItems`-filtered tree the serialiser did, so the indices agree.
 * Returns false when the path no longer resolves (the menu changed since it
 * was sent — a rebuilt template follows on the next sync).
 */
export function runNativeMenuAction(groups: ReadonlyArray<MenuGroupModel>, id: string): boolean {
  if (!isNativeMenuActionId(id)) return false;
  const [groupId, ...rest] = id.slice(NATIVE_MENU_ACTION_PREFIX.length).split('/');
  const group = groups.find((g) => g.id === groupId);
  if (!group) return false;
  let items: ReadonlyArray<MenuItemModel> = visibleItems(group.items);
  let item: MenuItemModel | undefined;
  for (const seg of rest) {
    const i = Number(seg);
    if (!Number.isInteger(i)) return false;
    item = items[i];
    if (!item) return false;
    items = visibleItems(resolveChildren(item));
  }
  if (!item?.onSelect) return false;
  item.onSelect();
  return true;
}

/** Every command id in a template, roles and action ids included. */
export function templateCommandIds(groups: ReadonlyArray<NativeMenuGroupSpec>): string[] {
  const out: string[] = [];
  const walk = (items: ReadonlyArray<NativeMenuItemSpec>): void => {
    for (const it of items) {
      if (it.commandId) out.push(it.commandId);
      if (it.submenu) walk(it.submenu);
    }
  };
  for (const g of groups) walk(g.items);
  return out;
}

/** Convenience for callers holding a registry: `lookup` over `asCommandId`. */
export function registryLookup(registry: { get(id: ReturnType<typeof asCommandId>): Command | undefined }) {
  return (id: string): Command | undefined => registry.get(asCommandId(id));
}
