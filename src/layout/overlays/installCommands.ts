/**
 * The commands that belong to the dialog / help / start-screen surfaces,
 * registered once from `ModalHost` — the one component mounted exactly once
 * in every editor window. Each installer is idempotent, and none of them
 * needs `Providers` or `menuModel` to know it exists; the menu rows that
 * should point at them are listed in each installer's header.
 */

import { installHelpCommands } from '@layout/Help/helpCommands';
import { maybeOpenWhatsNew } from '@layout/Help/WhatsNewDialog';
import { installExportPanelCommands } from '@layout/Export/exportPanelCommands';
import { registerPowerTourCommand } from '@stores/onboardingStore';

let installed = false;

export function installOverlayCommands(): void {
  if (installed) return;
  installed = true;
  try {
    installHelpCommands();
    installExportPanelCommands();
    registerPowerTourCommand();
  } catch {
    /* a pre-boot route without a registry — the editor route installs later */
  }
  // After boot has had a chance to open the recovery offer: a What's New that
  // raced it would land under (or over) a dialog that matters more.
  window.setTimeout(maybeOpenWhatsNew, 1500);
}
