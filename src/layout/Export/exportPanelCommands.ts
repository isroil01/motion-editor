/**
 * The docked Export panel's command. Menu row to add in `menuModel.ts` ▸
 * Window (beside Render Queue — the on-demand reachability test looks for `view.export` there):
 *
 *   { commandId: 'view.export', label: 'Export' }
 */

import { asCommandId } from '@app-types/common';
import { getCommandRegistry, type Command } from '@core/commands/Command';
import { useLayoutStore } from '@stores/layoutStore';

export const EXPORT_PANEL_ID = 'export';
export const VIEW_EXPORT_PANEL_COMMAND = asCommandId('view.export');

export function buildExportPanelCommands(): ReadonlyArray<Command> {
  return [
    {
      id: VIEW_EXPORT_PANEL_COMMAND,
      label: 'Export Panel',
      description: 'Dock the export form beside the inspector, to queue renders while you work.',
      icon: 'export',
      enabled: () => true,
      execute: () => {
        useLayoutStore.getState().openPanel(EXPORT_PANEL_ID);
      },
    },
  ];
}

let installed = false;

export function installExportPanelCommands(): void {
  if (installed) return;
  installed = true;
  const registry = getCommandRegistry();
  for (const c of buildExportPanelCommands()) registry.register(c);
}
