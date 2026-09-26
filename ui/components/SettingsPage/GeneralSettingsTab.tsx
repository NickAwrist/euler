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
import { EnableSwitch } from "../ModelPreferenceControls";
import { ModelSelectBar } from "../ModelSelectBar";
import { SystemPromptField } from "./SystemPromptField";
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

      <div>
        <h2 className={cx(eyebrowText, "mb-4")}>Personal Information</h2>
        <div className="space-y-2">
          <label htmlFor="name" className={labelClass}>
            Name <span className="text-muted-foreground">(optional)</span>
          </label>
          <input
            type="text"
            id="name"
            value={settings.name}
            onChange={(e) => onFieldChange("name", e.target.value)}
            placeholder="Enter your name"
            className={inputClass}
          />
          <p className={hintClass}>
            Your name will be used in conversations and messages.
          </p>
        </div>
        <div className="mt-4 space-y-2">
          <label htmlFor="location" className={labelClass}>
            Location <span className="text-muted-foreground">(optional)</span>
          </label>
          <input
            type="text"
            id="location"
            value={settings.location}
            onChange={(e) => onFieldChange("location", e.target.value)}
            placeholder="e.g., New York, USA"
            className={inputClass}
          />
          <p className={hintClass}>
            Your location can help provide more relevant responses.
          </p>
        </div>
      </div>

      <hr className="border-border-subtle" />

      <div className="space-y-4">
        <h2 className={cx(eyebrowText, "mb-4")}>Preferences</h2>
        <div className="space-y-2">
          <label htmlFor="preferredFormats" className={labelClass}>
            Preferred Response Formats{" "}
            <span className="text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="preferredFormats"
            value={settings.preferredFormats}
            onChange={(e) => onFieldChange("preferredFormats", e.target.value)}
            placeholder="e.g., JSON, Markdown tables, bullet points, code snippets"
            rows={3}
            className="min-h-[100px] w-full rounded-lg border border-border-subtle bg-surface px-3 py-2 text-[0.875rem] text-foreground placeholder:text-muted-foreground transition-colors focus:border-border focus:outline-none"
          />
          <p className={hintClass}>
            Specify how you prefer responses to be formatted.
          </p>
        </div>

        <div className="flex items-start gap-3 pt-1">
          <EnableSwitch
            id="includeCurrentDate"
            label="Include current date"
            checked={settings.includeCurrentDate}
            onChange={(checked) => onFieldChange("includeCurrentDate", checked)}
          />
          <div className="space-y-0.5">
            <label htmlFor="includeCurrentDate" className={labelClass}>
              Include current date
            </label>
            <p className={hintClass}>
              Include today&apos;s date in the system prompt so models know what
              day it is.
            </p>
          </div>
        </div>
      </div>

      <hr className="border-border-subtle" />

      <div>
        <h2 className={cx(eyebrowText, "mb-4")}>Agent</h2>
        <SystemPromptField
          value={settings.systemPrompt}
          onChange={(value) => onFieldChange("systemPrompt", value)}
        />
      </div>

      <hr className="border-border-subtle" />

      <div className="space-y-2">
        <h2 className={cx(eyebrowText, "mb-2")}>Chat Defaults</h2>
        <div className="space-y-2">
          <label htmlFor="run-model" className={labelClass}>
            Default Model
          </label>
          <ModelSelectBar
            ollamaModels={availableModels}
            ollamaConnected={catalogLoaded ? true : null}
            modelsLoadError={null}
            selectedModel={effectiveModel}
            onModelChange={(model) => onFieldChange("defaultModel", model)}
            disabled={!catalogLoaded || !effectiveModel}
          />
          {settings.defaultModel && (
            <Button
              variant="ghost"
              onClick={() => onFieldChange("defaultModel", "")}
            >
              Use first available model
            </Button>
          )}
          <p className={hintClass}>
            {!catalogLoaded
              ? "Loading models..."
              : !effectiveModel
                ? "No models available. Connect a provider and enable a model to start chatting."
                : settings.defaultModel &&
                    settings.defaultModel !== effectiveModel
                  ? `Saved model ${settings.defaultModel} is unavailable. New chats will use the model shown above.`
                  : "New chats will use this model."}
          </p>
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
