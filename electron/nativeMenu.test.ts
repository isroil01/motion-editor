/**
 * Main's half of the generated native menu: the renderer's payload is
 * validated, the roles main must own are kept, every other entry forwards
 * its command id.
 */

import { nativeTemplateFromGroups, sanitizeMenuGroups, type NativeMenuGroupSpec } from './nativeMenu';

const GROUPS: NativeMenuGroupSpec[] = [
  {
    id: 'file',
    label: 'File',
    items: [
      { label: 'New Project', commandId: 'project.new', accelerator: 'Ctrl+N' },
      { type: 'separator' },
      { label: 'Save', commandId: 'project.save', accelerator: 'Ctrl+S' },
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    items: [
      { label: 'Undo', commandId: 'edit.undo', accelerator: 'Ctrl+Z' },
      { label: 'Cut', commandId: 'edit.cut', accelerator: 'Ctrl+X' },
      { label: 'Copy', commandId: 'edit.copy' },
      { label: 'Paste', commandId: 'edit.paste' },
    ],
  },
  {
    id: 'view',
    label: 'View',
    items: [
      { label: 'Use Proxies', commandId: 'view.useProxies', checked: true },
      { label: 'Cache', submenu: [{ label: 'Purge', commandId: 'preview.purgeRam' }] },
    ],
  },
  { id: 'window', label: 'Window', items: [{ label: 'History', commandId: 'view.history' }] },
  { id: 'help', label: 'Help', items: [{ label: 'About', commandId: 'help.about' }] },
];

const opts = (platform: NodeJS.Platform, isDev = false) => ({
  platform,
  isDev,
  version: '1.2.3',
  cmd: (id: string) => Object.assign(() => undefined, { forwards: id }),
  checkForUpdates: () => undefined,
});

describe('sanitizeMenuGroups', () => {
  it('accepts the renderer’s shape and rejects anything else', () => {
    expect(sanitizeMenuGroups(GROUPS)).toEqual(GROUPS);
    expect(sanitizeMenuGroups(null)).toBeNull();
    expect(sanitizeMenuGroups([])).toBeNull();
    expect(sanitizeMenuGroups([{ id: 'x', label: 'X', items: [{ label: 'no action' }] }])).toBeNull();
    expect(sanitizeMenuGroups([{ id: 'x', label: 'X', items: [{ label: 'bad id', commandId: 'rm -rf /' }] }])).toBeNull();
    expect(sanitizeMenuGroups([{ id: 'x', label: 'X', items: [{ label: 'bad accel', commandId: 'a.b', accelerator: 'Ctrl+`; evil' }] }])).toBeNull();
    expect(sanitizeMenuGroups([{ id: 'x', label: 'X', items: [{ label: 'fn', commandId: 'a.b', click: () => 1 }] }])).toEqual([
      { id: 'x', label: 'X', items: [{ label: 'fn', commandId: 'a.b' }] },
    ]);
  });
});

describe('nativeTemplateFromGroups', () => {
  it('forwards command ids through clicks main creates, with accelerators and checkboxes', () => {
    const t = nativeTemplateFromGroups(GROUPS, opts('win32'));
    const file = t.find((m) => m.label === 'File')!;
    const first = (file.submenu as Array<{ label?: string; accelerator?: string; click?: { forwards?: string } }>)[0]!;
    expect(first.label).toBe('New Project');
    expect(first.accelerator).toBe('Ctrl+N');
    expect(first.click?.forwards).toBe('project.new');
    const view = t.find((m) => m.label === 'View')!;
    const proxies = (view.submenu as Array<{ type?: string; checked?: boolean }>)[0]!;
    expect(proxies.type).toBe('checkbox');
    expect(proxies.checked).toBe(true);
    const cache = (view.submenu as Array<{ submenu?: Array<{ label?: string }> }>)[1]!;
    expect(cache.submenu?.[0]?.label).toBe('Purge');
  });

  it('keeps native roles for Cut / Copy / Paste and Quit, and no app menu off macOS', () => {
    const t = nativeTemplateFromGroups(GROUPS, opts('win32'));
    expect(t[0]!.role).toBeUndefined();
    const edit = t.find((m) => m.label === 'Edit')!.submenu as Array<{ role?: string; label?: string }>;
    expect(edit.map((i) => i.role ?? i.label)).toEqual(['Undo', 'cut', 'copy', 'paste']);
    const file = t.find((m) => m.label === 'File')!.submenu as Array<{ role?: string }>;
    expect(file[file.length - 1]!.role).toBe('quit');
  });

  it('adds the macOS app menu and Close on darwin', () => {
    const t = nativeTemplateFromGroups(GROUPS, opts('darwin'));
    expect(t[0]!.role).toBe('appMenu');
    const file = t.find((m) => m.label === 'File')!.submenu as Array<{ role?: string }>;
    expect(file[file.length - 1]!.role).toBe('close');
  });

  it('owns Check for Updates, the version line, and dev-only items', () => {
    const help = nativeTemplateFromGroups(GROUPS, opts('win32')).find((m) => m.role === 'help')!;
    const labels = (help.submenu as Array<{ label?: string; enabled?: boolean }>).map((i) => i.label);
    expect(labels[0]).toBe('Check for Updates…');
    expect(labels).toContain('About');
    expect(labels[labels.length - 1]).toBe('Version 1.2.3');
    const viewProd = nativeTemplateFromGroups(GROUPS, opts('win32', false)).find((m) => m.label === 'View')!;
    expect((viewProd.submenu as Array<{ role?: string }>).some((i) => i.role === 'toggleDevTools')).toBe(false);
    const viewDev = nativeTemplateFromGroups(GROUPS, opts('win32', true)).find((m) => m.label === 'View')!;
    expect((viewDev.submenu as Array<{ role?: string }>).some((i) => i.role === 'toggleDevTools')).toBe(true);
  });
});
