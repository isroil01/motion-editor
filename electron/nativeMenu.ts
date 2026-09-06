/**
 * Native application menu, built from the template the RENDERER serialises
 * out of its `menuModel.ts` (see `src/layout/Menu/nativeMenuTemplate.ts`).
 *
 * Main owns only what a renderer cannot: the macOS app menu, Quit/Close,
 * the Cut/Copy/Paste roles, Check for Updates, the version line and the
 * developer items. Everything else — labels, order, submenus, accelerators,
 * checked state — arrives from the renderer and is validated here before it
 * becomes a menu, because IPC is a trust boundary: the shape is checked
 * field by field and every click is a closure WE create that forwards a
 * command id; nothing executable crosses the wire.
 *
 * Pure (no `electron` runtime import — types only), so it is unit-tested
 * without the binary.
 */

import type { MenuItemConstructorOptions } from 'electron';

export interface NativeMenuItemSpec {
  type?: 'separator';
  label?: string;
  commandId?: string;
  accelerator?: string;
  checked?: boolean;
  submenu?: NativeMenuItemSpec[];
}

export interface NativeMenuGroupSpec {
  id: string;
  label: string;
  items: NativeMenuItemSpec[];
}

/** Commands whose native role must win over the renderer's command. */
const ROLE_BY_COMMAND: Record<string, MenuItemConstructorOptions['role']> = {
  'edit.cut': 'cut',
  'edit.copy': 'copy',
  'edit.paste': 'paste',
};

const ID_RE = /^[\w.:/-]{1,200}$/;
const ACCEL_RE = /^[\w+]{1,40}$/;
const MAX_DEPTH = 6;
const MAX_ITEMS = 400;

function sanitizeItems(raw: unknown, depth: number, budget: { n: number }): NativeMenuItemSpec[] | null {
  if (!Array.isArray(raw) || depth > MAX_DEPTH) return null;
  const out: NativeMenuItemSpec[] = [];
  for (const r of raw) {
    if (budget.n-- <= 0) return null;
    if (!r || typeof r !== 'object') return null;
    const it = r as Record<string, unknown>;
    if (it.type === 'separator') { out.push({ type: 'separator' }); continue; }
    if (typeof it.label !== 'string' || it.label.length > 200) return null;
    const spec: NativeMenuItemSpec = { label: it.label };
    if (it.commandId !== undefined) {
      if (typeof it.commandId !== 'string' || !ID_RE.test(it.commandId)) return null;
      spec.commandId = it.commandId;
    }
    if (it.accelerator !== undefined) {
      if (typeof it.accelerator !== 'string' || !ACCEL_RE.test(it.accelerator)) return null;
      spec.accelerator = it.accelerator;
    }
    if (it.checked !== undefined) {
      if (typeof it.checked !== 'boolean') return null;
      spec.checked = it.checked;
    }
    if (it.submenu !== undefined) {
      const sub = sanitizeItems(it.submenu, depth + 1, budget);
      if (!sub) return null;
      spec.submenu = sub;
    }
    if (!spec.commandId && !spec.submenu) return null; // a label that does nothing
    out.push(spec);
  }
  return out;
}

/** The renderer's payload, or null when any part of it is not what we expect. */
export function sanitizeMenuGroups(raw: unknown): NativeMenuGroupSpec[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 20) return null;
  const budget = { n: MAX_ITEMS };
  const out: NativeMenuGroupSpec[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') return null;
    const g = r as Record<string, unknown>;
    if (typeof g.id !== 'string' || !/^[\w-]{1,40}$/.test(g.id)) return null;
    if (typeof g.label !== 'string' || g.label.length > 60) return null;
    const items = sanitizeItems(g.items, 0, budget);
    if (!items) return null;
    out.push({ id: g.id, label: g.label, items });
  }
  return out;
}

export interface NativeMenuOptions {
  platform: NodeJS.Platform;
  isDev: boolean;
  version: string;
  /** A click handler that forwards `commandId` to the renderer. */
  cmd: (commandId: string) => () => void;
  checkForUpdates: () => void;
}

function toOptions(items: ReadonlyArray<NativeMenuItemSpec>, opts: NativeMenuOptions): MenuItemConstructorOptions[] {
  return items.map((it): MenuItemConstructorOptions => {
    if (it.type === 'separator') return { type: 'separator' };
    if (it.submenu) return { label: it.label, submenu: toOptions(it.submenu, opts) };
    const role = it.commandId ? ROLE_BY_COMMAND[it.commandId] : undefined;
    if (role) return { role };
    const base: MenuItemConstructorOptions = {
      label: it.label,
      click: opts.cmd(it.commandId!),
      ...(it.accelerator ? { accelerator: it.accelerator } : {}),
    };
    return typeof it.checked === 'boolean' ? { ...base, type: 'checkbox', checked: it.checked } : base;
  });
}

/**
 * The full `Menu.buildFromTemplate` input for the renderer's groups plus the
 * items main must own.
 */
export function nativeTemplateFromGroups(
  groups: ReadonlyArray<NativeMenuGroupSpec>,
  opts: NativeMenuOptions,
): MenuItemConstructorOptions[] {
  const mac = opts.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [];
  if (mac) template.push({ role: 'appMenu' });

  for (const g of groups) {
    const submenu = toOptions(g.items, opts);
    switch (g.id) {
      case 'file':
        submenu.push({ type: 'separator' }, mac ? { role: 'close' } : { role: 'quit' });
        break;
      case 'view':
        // Reload + DevTools are developer affordances only — omitted from
        // shipped builds so end users get no inspector and no accidental hard
        // reload.
        if (opts.isDev) submenu.push({ type: 'separator' }, { role: 'reload' }, { role: 'toggleDevTools' });
        break;
      case 'window':
        submenu.push({ type: 'separator' }, { role: 'minimize' }, { role: 'togglefullscreen' });
        if (mac) submenu.push({ role: 'front' });
        break;
      case 'help':
        // Not a command forwarded to the renderer: updating is the shell's
        // job, and the renderer is what gets replaced.
        submenu.unshift({ label: 'Check for Updates…', click: opts.checkForUpdates }, { type: 'separator' });
        submenu.push({ type: 'separator' }, { label: `Version ${opts.version}`, enabled: false });
        break;
      default:
        break;
    }
    template.push(g.id === 'help' ? { role: 'help', submenu } : { label: g.label, submenu });
  }
  return template;
}
