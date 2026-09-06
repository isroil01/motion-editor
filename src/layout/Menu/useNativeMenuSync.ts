/**
 * Keeps the Electron native menu in step with the in-app menu model.
 *
 * Mounted once, by the Electron title bar. Serialises `useAppMenuGroups()`
 * (so the Plugins group and the workspace presets are in it) through
 * `buildNativeMenuTemplate` and hands it to main over `setMenuTemplate`;
 * re-sends when the groups change, and a couple of times after mount because
 * the title bar renders BEFORE Providers has registered the commands the
 * labels and chords come from.
 *
 * Also answers the `menu.action:` ids main sends back for entries that have
 * no command (see `nativeMenuTemplate.ts`).
 */

import { useEffect, useRef } from 'react';
import { getCommandRegistry } from '@core/commands/Command';
import { resolveChord, getShortcutOverrides } from '@core/commands/shortcutOverrides';
import { useAppMenuGroups } from './useAppMenuGroups';
import {
  buildNativeMenuTemplate,
  isNativeMenuActionId,
  registryLookup,
  runNativeMenuAction,
  type NativePlatform,
} from './nativeMenuTemplate';

/** Delays after mount at which the template is re-sent, so late registrations land. */
const RESEND_DELAYS_MS = [800, 3000];

function platformNow(): NativePlatform {
  const p = typeof navigator !== 'undefined' ? navigator.platform : '';
  return /Mac|iPhone|iPad/.test(p) ? 'darwin' : 'other';
}

export function useNativeMenuSync(): void {
  const groups = useAppMenuGroups();
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  useEffect(() => {
    const api = window.motionEditor ?? window.electronAPI;
    const send = api?.setMenuTemplate;
    if (!send) return;
    const sync = (): void => {
      let template;
      try {
        template = buildNativeMenuTemplate(groupsRef.current, {
          lookup: registryLookup(getCommandRegistry()),
          resolveChord: (cmd) => resolveChord(cmd.id as unknown as string, cmd.shortcut, getShortcutOverrides()),
          platform: platformNow(),
        });
      } catch {
        return; // a `checked()` that throws pre-boot must not take the menu down
      }
      void send(template);
    };
    sync();
    const timers = RESEND_DELAYS_MS.map((ms) => window.setTimeout(sync, ms));
    return () => { for (const t of timers) window.clearTimeout(t); };
  }, [groups]);

  useEffect(() => {
    const api = window.motionEditor ?? window.electronAPI;
    return api?.onMenuCommand?.((id) => {
      if (isNativeMenuActionId(id)) runNativeMenuAction(groupsRef.current, id);
    });
  }, []);
}
