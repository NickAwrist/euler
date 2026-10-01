import { ApiKeySettingsCard } from "./ApiKeySettingsCard";
import { hintClass } from "./constants";
import { useApiKeySetting } from "./useApiKeySetting";

export function WebSearchTab() {
  const key = useApiKeySetting("brave");
  return (
    <div className="space-y-4">
      <ApiKeySettingsCard
        setting={key}
        title="Brave Search API key"
        inputId="brave-key"
        placeholder="BSA..."
      />
      <p className={hintClass}>
        Agents search the web with Brave Search. Create a key in the{" "}
        <a
          href="https://api-dashboard.search.brave.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ring"
        >
          Brave Search API dashboard
        </a>
        .
      </p>
    </div>
  );
}
