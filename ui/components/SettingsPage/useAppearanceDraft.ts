import { useState } from "react";
import { useSavedDraft } from "../../hooks/useSavedDraft";
import { changedFields } from "../../lib/changedFields";
import {
  type Appearance,
  applyAppearance,
  loadAppearance,
  saveAppearance,
} from "../../persist/appearance";

const APPEARANCE_FIELDS = [
  ["theme", "Color theme"],
  ["chatWidth", "Chat width"],
  ["font", "Font style"],
  ["codeFont", "Code block font"],
  ["shiftForChatList", "Make room for the chat list"],
  ["shiftForArtifacts", "Make room for artifacts"],
  ["sidebarAnimationMs", "Sidebar animation"],
] as const satisfies readonly (readonly [keyof Appearance, string])[];

/** Unsaved appearance choices; they apply to the page only once saved. */
export function useAppearanceDraft() {
  const [saved, setSaved] = useState(loadAppearance);
  const draft = useSavedDraft(saved);
  const changes = APPEARANCE_FIELDS.filter(
    ([key]) => draft.value[key] !== saved[key],
  ).map(([, label]) => label);

  return {
    appearance: draft.value,
    setAppearance: draft.setValue,
    changes,
    /** Saves only edited fields; throws when the server rejects them. */
    save: async () => {
      const next = await saveAppearance(changedFields(draft.value, saved));
      applyAppearance(next);
      setSaved(next);
      draft.accept();
    },
    reset: draft.reset,
  };
}
