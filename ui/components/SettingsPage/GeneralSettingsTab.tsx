import { RotateCcw } from "lucide-react";
import { useState } from "react";
import { effectiveDefaultRunModel } from "../../lib/defaultModel";
import {
  getOrCreateUserId,
  normalizeUserId,
  switchUserId,
} from "../../persist/userIdentity";
import type { UserSettings } from "../../persist/userSettings";
import { cx, eyebrowText } from "../../styles";
import type { ModelOption } from "../../types";
import { Button } from "../Button";
import { IconButton } from "../IconButton";
import { EnableSwitch } from "../ModelPreferenceControls";
import { ModelSelectBar } from "../ModelSelectBar";
import { hintClass, inputClass, labelClass } from "./constants";

type Props = {
  settings: UserSettings;
  onFieldChange: <K extends keyof UserSettings>(
    field: K,
    value: UserSettings[K],
  ) => void;
  availableModels: ModelOption[];
  catalogLoaded: boolean;
};

export function GeneralSettingsTab({
  settings,
  onFieldChange,
  availableModels,
  catalogLoaded,
}: Props) {
  const effectiveModel = effectiveDefaultRunModel(
    settings.defaultModel,
    availableModels,
  );
  const [currentUserId] = useState(getOrCreateUserId);
  const [userIdDraft, setUserIdDraft] = useState(currentUserId);
  const normalizedDraft = normalizeUserId(userIdDraft);
  const canSwitch =
    normalizedDraft !== null && normalizedDraft !== currentUserId;

  const handleSwitchUser = () => {
    if (!canSwitch || !switchUserId(userIdDraft)) return;
    window.history.replaceState({}, "", "/");
    window.location.reload();
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className={cx(eyebrowText, "mb-4")}>Browser Data UUID</h2>
        <div className="space-y-2">
          <label htmlFor="userUuid" className={labelClass}>
            UUID
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              id="userUuid"
              value={userIdDraft}
              onChange={(event) => setUserIdDraft(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              className={cx(inputClass, "font-mono text-[0.8125rem]")}
            />
            <Button
              variant="secondary"
              disabled={!canSwitch}
              onClick={handleSwitchUser}
              className="shrink-0 justify-center"
            >
              Switch UUID
            </Button>
          </div>
          {userIdDraft.trim().length > 0 && normalizedDraft === null && (
            <p className="text-[0.75rem] text-red-400">
              Enter a UUID in the form xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx.
            </p>
          )}
          <p className={hintClass}>
            Chats and skills are loaded for this UUID. Change it and switch to
            load another UUID&apos;s data.
          </p>
        </div>
      </div>

      <hr className="border-border-subtle" />

      <div className="space-y-2">
        <h2 className={cx(eyebrowText, "mb-2")}>Chat Defaults</h2>
        <div className="space-y-2">
          <label htmlFor="run-model" className={labelClass}>
            Default Model
          </label>
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <ModelSelectBar
                ollamaModels={availableModels}
                ollamaConnected={catalogLoaded ? true : null}
                modelsLoadError={null}
                selectedModel={effectiveModel}
                onModelChange={(model) => onFieldChange("defaultModel", model)}
                disabled={!catalogLoaded || !effectiveModel}
              />
            </div>
            <IconButton
              icon={RotateCcw}
              label="Reset default model"
              title="Reset to first available model"
              variant="ghost"
              disabled={!settings.defaultModel}
              onClick={() => onFieldChange("defaultModel", "")}
              className="shrink-0"
            />
          </div>
          {!catalogLoaded ? (
            <p className={hintClass}>Loading models...</p>
          ) : !effectiveModel ? (
            <p className={hintClass}>
              No models available. Connect a provider and enable a model to
              start chatting.
            </p>
          ) : settings.defaultModel &&
            settings.defaultModel !== effectiveModel ? (
            <p className={hintClass}>
              Saved model {settings.defaultModel} is unavailable. New chats will
              use the model shown above.
            </p>
          ) : null}
        </div>
      </div>
      <details className="border-t border-border-subtle pt-4">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Developer tools
        </summary>
        <div className="mt-3 flex items-start gap-3 text-[0.8125rem] text-muted-foreground">
          <EnableSwitch
            id="showDebugButton"
            label="Display debug button"
            checked={settings.showDebugButton}
            onChange={(checked) => onFieldChange("showDebugButton", checked)}
          />
          <label htmlFor="showDebugButton">
            Display debug button
            <span className="mt-1 block text-xs">
              Inspect model context and request details.
            </span>
          </label>
        </div>
      </details>
    </div>
  );
}
