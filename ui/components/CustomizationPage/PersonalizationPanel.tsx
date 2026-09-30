import { hintClass, inputClass, labelClass, textareaClass } from "../../styles";
import type { Personalization } from "../../types";
import { EnableSwitch } from "../ModelPreferenceControls";
import { SystemPromptField } from "./SystemPromptField";

export function PersonalizationPanel({
  settings,
  onChange,
}: {
  settings: Personalization;
  onChange: <K extends keyof Personalization>(
    key: K,
    value: Personalization[K],
  ) => void;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <section className="space-y-4" aria-label="Agent instructions">
        <SystemPromptField
          value={settings.systemPrompt}
          onChange={(value) => onChange("systemPrompt", value)}
        />
        <div className="flex items-start gap-3">
          <EnableSwitch
            id="includeCurrentDate"
            label="Include current date"
            checked={settings.includeCurrentDate}
            onChange={(checked) => onChange("includeCurrentDate", checked)}
          />
          <div className="space-y-1">
            <label htmlFor="includeCurrentDate" className={labelClass}>
              Include current date
            </label>
            <p className={hintClass}>
              Give the agent today&apos;s date as context.
            </p>
          </div>
        </div>
      </section>
      <section
        className="space-y-5 border-t border-border-subtle pt-6"
        aria-labelledby="personalization-heading"
      >
        <div className="space-y-1">
          <h2
            id="personalization-heading"
            className="text-[0.9375rem] font-semibold text-foreground"
          >
            Personalization
          </h2>
          <p className={hintClass}>
            Tell the agent about yourself and how you prefer responses.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="name" className={labelClass}>
              Name{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <input
              id="name"
              value={settings.name}
              onChange={(event) => onChange("name", event.target.value)}
              placeholder="Enter your name"
              className={inputClass}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="location" className={labelClass}>
              Location{" "}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </label>
            <input
              id="location"
              value={settings.location}
              onChange={(event) => onChange("location", event.target.value)}
              placeholder="e.g., New York, USA"
              className={inputClass}
            />
          </div>
        </div>
        <div className="space-y-2">
          <label htmlFor="preferredFormats" className={labelClass}>
            Preferred response formats{" "}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </label>
          <textarea
            id="preferredFormats"
            value={settings.preferredFormats}
            onChange={(event) =>
              onChange("preferredFormats", event.target.value)
            }
            placeholder="e.g., Markdown tables, bullet points, code snippets"
            rows={3}
            className={textareaClass}
          />
        </div>
      </section>
    </div>
  );
}
