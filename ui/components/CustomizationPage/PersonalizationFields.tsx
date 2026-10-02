import { inputClass, labelClass, textareaClass } from "../../styles";
import type { Personalization } from "../../types";

type AboutYou = Pick<Personalization, "name" | "location" | "preferredFormats">;

/** Optional details about the user that are added to agent instructions. */
export function PersonalizationFields({
  settings,
  onChange,
}: {
  settings: AboutYou;
  onChange: <K extends keyof AboutYou>(key: K, value: AboutYou[K]) => void;
}) {
  return (
    <>
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
          <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <textarea
          id="preferredFormats"
          value={settings.preferredFormats}
          onChange={(event) => onChange("preferredFormats", event.target.value)}
          placeholder="e.g., Markdown tables, bullet points, code snippets"
          rows={3}
          className={textareaClass}
        />
      </div>
    </>
  );
}
