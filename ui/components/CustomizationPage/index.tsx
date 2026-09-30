import { useState } from "react";
import type { UserSettings } from "../../persist/userSettings";
import { cx } from "../../styles";
import type { Personalization } from "../../types";
import { BackToChatButton } from "../BackToChatButton";
import { PersonalizationTab } from "./PersonalizationTab";
import { SkillsTab } from "./SkillsTab";

export function CustomizationPage({
  onBack,
  currentSettings,
  onSave,
}: {
  onBack: () => void;
  currentSettings: UserSettings;
  onSave: (settings: Personalization) => Promise<void>;
}) {
  const [tab, setTab] = useState<"personalization" | "skills">(
    "personalization",
  );
  const [skillsVisited, setSkillsVisited] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-5 py-3">
        <BackToChatButton onClick={onBack} />
        <div className="h-4 w-px bg-border-subtle" />
        <h1 className="text-[0.9375rem] font-semibold text-foreground">
          Customization
        </h1>
      </header>
      <div className="flex shrink-0 gap-1 border-b border-border-subtle px-3 sm:px-5">
        {(["personalization", "skills"] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              setTab(id);
              if (id === "skills") setSkillsVisited(true);
            }}
            className={cx(
              "flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-[0.8125rem] font-medium transition-colors sm:px-4",
              tab === id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {id === "personalization" ? "Personalization" : "Skills"}
            {id === "personalization" && isDirty && (
              <span aria-hidden className="size-1.5 rounded-full bg-accent" />
            )}
          </button>
        ))}
      </div>
      {skillsVisited && (
        <div
          className={
            tab === "skills" ? "flex min-h-0 flex-1 flex-col" : "hidden"
          }
        >
          <SkillsTab />
        </div>
      )}
      <PersonalizationTab
        active={tab === "personalization"}
        currentSettings={currentSettings}
        onSave={onSave}
        onDirtyChange={setIsDirty}
      />
    </div>
  );
}
