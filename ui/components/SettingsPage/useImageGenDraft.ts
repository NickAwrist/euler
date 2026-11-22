import { useState } from "react";
import { ImageProvider } from "../../../src/gen/euler/v1/preferences_pb";
import { useSavedDraft } from "../../hooks/useSavedDraft";
import { changedFields } from "../../lib/changedFields";
import {
  getUserPreferences,
  updateUserPreferences,
} from "../../persist/userPreferences";

export type ImageGenDraftValue = {
  provider: ImageProvider;
  model: string;
};

function loadImagePreferences(): ImageGenDraftValue {
  const image = getUserPreferences().image;
  return {
    provider: image?.provider ?? ImageProvider.UNSPECIFIED,
    model: image?.model ?? "",
  };
}

/** Unsaved image generation preferences; applied once saved. */
export function useImageGenDraft() {
  const [saved, setSaved] = useState(loadImagePreferences);
  const draft = useSavedDraft(saved);

  const changes = (
    [
      ["Image provider", draft.value.provider !== saved.provider],
      ["Image model", draft.value.model !== saved.model],
    ] as const
  )
    .filter(([, dirty]) => dirty)
    .map(([label]) => label);

  return {
    provider: draft.value.provider,
    model: draft.value.model,
    setProvider: (provider: ImageProvider) => {
      draft.setValue({
        provider,
        // Reset the model when switching providers so an incompatible ID isn't kept.
        model: provider === saved.provider ? saved.model : "",
      });
    },
    setModel: (model: string) => {
      draft.setValue((previous) => ({ ...previous, model }));
    },
    changes,
    save: async () => {
      const patch = changedFields(draft.value, saved);
      const updated = await updateUserPreferences({ image: patch });
      const next: ImageGenDraftValue = {
        provider: updated.image?.provider ?? ImageProvider.UNSPECIFIED,
        model: updated.image?.model ?? "",
      };
      setSaved(next);
      draft.accept();
    },
    reset: draft.reset,
  };
}
