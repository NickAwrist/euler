import { useState } from "react";
import {
  getOrCreateUserId,
  normalizeUserId,
  switchUserId,
} from "../../persist/userIdentity";
import type { UserSettings } from "../../persist/userSettings";
import { cx, eyebrowText } from "../../styles";
import type { ModelOption } from "../../types";
import { Button } from "../Button";
import { hintClass, inputClass, labelClass, selectClass } from "./constants";

type Props = {
  settings: UserSettings;
  onFieldChange: <K extends keyof UserSettings>(
    field: K,
    value: UserSettings[K],
  ) => void;
  availableModels: ModelOption[];
};

export function GeneralSettingsTab({
  settings,
  onFieldChange,
  availableModels,
}: Props) {
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
            Chats and agents are loaded for this UUID. Change it and switch to
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
          <input
            type="checkbox"
            id="includeCurrentDate"
            checked={settings.includeCurrentDate}
            onChange={(e) =>
              onFieldChange("includeCurrentDate", e.target.checked)
            }
            className="mt-0.5 h-4 w-4 rounded border-border-subtle bg-surface text-primary focus:ring-primary"
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

      <div className="space-y-2">
        <h2 className={cx(eyebrowText, "mb-2")}>Chat Defaults</h2>
        <div className="space-y-2">
          <label htmlFor="defaultModel" className={labelClass}>
            Default Model
          </label>
          <select
            id="defaultModel"
            value={settings.defaultModel}
            onChange={(e) => onFieldChange("defaultModel", e.target.value)}
            className={selectClass}
          >
            <option value="">Select a default model</option>
            {(["ollama", "openrouter"] as const).map((provider) => {
              const models = availableModels.filter(
                (model) => model.provider === provider,
              );
              if (models.length === 0) return null;
              return (
                <optgroup
                  key={provider}
                  label={provider === "ollama" ? "Ollama" : "OpenRouter"}
                >
                  {models.map((model) => (
                    <option
                      key={model.id}
                      value={model.id}
                      disabled={
                        model.provider === "openrouter" &&
                        model.configured === false
                      }
                    >
                      {model.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </div>
      </div>
      <details className="border-t border-border-subtle pt-4">
        <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
          Developer tools
        </summary>
        <label className="mt-3 flex items-start gap-3 text-[0.8125rem] text-muted-foreground">
          <input
            type="checkbox"
            checked={settings.showDebugButton}
            onChange={(event) =>
              onFieldChange("showDebugButton", event.target.checked)
            }
            className="mt-0.5 h-4 w-4 rounded border-border-subtle bg-surface text-primary focus:ring-primary"
          />
          <span>
            Display debug button
            <span className="mt-1 block text-xs">
              Inspect model context and request details.
            </span>
          </span>
        </label>
      </details>
    </div>
  );
}
