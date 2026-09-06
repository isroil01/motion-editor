/**
 * Help-menu commands that ship with this directory: What's New and the
 * documentation opener. Registered from the modal host (always mounted once),
 * the same pattern as `timelineFitCommands.ts`. Menu rows to add in
 * `menuModel.ts` ▸ Help:
 *
 *   { commandId: 'help.whatsNew',  label: "What's New…" }
 *   { commandId: 'help.docs',      label: 'Documentation' }
 *   { commandId: 'help.powerTour', label: 'Power-user tour' }   (onboardingStore)
 */

import { asCommandId } from '@app-types/common';
import { getCommandRegistry, type Command } from '@core/commands/Command';
import { openWhatsNew } from './WhatsNewDialog';
import { openHelp } from './openHelp';

export const HELP_WHATS_NEW_COMMAND = asCommandId('help.whatsNew');
export const HELP_DOCS_COMMAND = asCommandId('help.docs');

export function buildHelpCommands(): ReadonlyArray<Command> {
  return [
    {
      id: HELP_WHATS_NEW_COMMAND,
      label: "What's New…",
      description: 'The changelog for this version.',
      icon: 'sparkles',
      enabled: () => true,
      execute: () => {
        openWhatsNew();
      },
    },
    {
      id: HELP_DOCS_COMMAND,
      label: 'Documentation',
      description: 'Open the editor reference.',
      icon: 'info',
      enabled: () => true,
      execute: () => {
        void openHelp('editor');
      },
    },
  ];
}

let installed = false;

export function installHelpCommands(): void {
  if (installed) return;
  installed = true;
  const registry = getCommandRegistry();
  for (const c of buildHelpCommands()) registry.register(c);
}
