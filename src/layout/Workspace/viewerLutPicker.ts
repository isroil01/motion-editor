/**
 * The one file picker for the viewer LUT, shared by the Preview menu, the
 * header strip and the `view.viewerLut.load` command — so all three load a
 * `.cube` the same way and report a bad file the same way.
 */

import { useViewerLutStore } from '@stores/viewerLutStore';
import { useUIStore } from '@stores/uiStore';

export function openViewerLutPicker(): void {
  if (typeof document === 'undefined') return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.cube,text/plain';
  input.style.display = 'none';
  input.onchange = () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    void file.text().then((text) => {
      if (!useViewerLutStore.getState().loadFromText(text, file.name)) {
        useUIStore.getState().notify({ level: 'error', message: `“${file.name}” is not a .cube LUT this viewer can read.`, durationMs: 4200 });
      }
    });
  };
  document.body.appendChild(input);
  input.click();
}
