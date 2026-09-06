/**
 * Open/closed state for the inline AI prompt (`InlineAiPrompt.tsx`).
 *
 * A module-level store rather than component state so the `ai.inlinePrompt`
 * command — dispatched from the shortcut manager, outside React — can open
 * it. Layout-local: this is a viewport widget's toggle, not project or
 * editor state, so it does not join `src/stores`.
 */

import { create } from 'zustand';
import { useSelectionStore } from '@stores/selectionStore';

interface InlineAiPromptState {
  open: boolean;
  /** Selection ids the prompt was opened for — its anchor and its subject. */
  targetIds: readonly string[];
  openFor: (ids: readonly string[]) => void;
  close: () => void;
}

export const useInlineAiPromptStore = create<InlineAiPromptState>((set) => ({
  open: false,
  targetIds: [],
  openFor: (ids) => set({ open: true, targetIds: [...ids] }),
  close: () => set({ open: false, targetIds: [] }),
}));

/** Open the prompt for the current selection (the command's entry point). */
export function openInlineAiPrompt(ids?: readonly string[]): void {
  const targets = ids ?? useSelectionStore.getState().ids;
  if (targets.length === 0) return;
  useInlineAiPromptStore.getState().openFor(targets);
}
