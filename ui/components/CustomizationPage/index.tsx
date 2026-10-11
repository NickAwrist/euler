import { useState } from "react";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";
import type { UserSettings } from "../../persist/userSettings";
import { cx } from "../../styles";
import type { Personalization } from "../../types";
import { BackToChatButton } from "../BackToChatButton";
import { UnsavedChangesModal } from "../UnsavedChangesModal";
import { PersonalizationTab } from "./PersonalizationTab";
import { SkillsTab } from "./SkillsTab";
import { ToolsTab } from "./ToolsTab";
import { usePersonalizationDraft } from "./usePersonalizationDraft";
import { useSkillsPage } from "./useSkillsPage";

const TABS = [
  { id: "personalization", label: "Personalization" },
  { id: "skills", label: "Skills" },
  { id: "tools", label: "Tools" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export function CustomizationPage({
  onBack,
  currentSettings,
  onSave,
}: {
  onBack: () => void;
  currentSettings: UserSettings;
  onSave: (settings: Partial<Personalization>) => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>("personalization");
  // Tabs mount on first visit and stay mounted to keep their state.
  const [visited, setVisited] = useState<ReadonlySet<Tab>>(
    () => new Set(["personalization"]),
  );
  const personalization = usePersonalizationDraft(currentSettings, onSave);
  const skills = useSkillsPage();
  const drafts = [
    {
      tab: "personalization",
      label: "Personalization",
      draft: personalization,
    },
    { tab: "skills", label: "Skills", draft: skills },
  ] as const;
  const changes = drafts.flatMap(({ label, draft }) =>
    draft.changes.map((change) => ({ ...change, group: label })),
  );
  const { prompt, resolveLeave } = useUnsavedChanges(changes.length > 0);
  const openTab = (id: Tab) => {
    setTab(id);
    setVisited((current) => new Set(current).add(id));
  };
  // Stops at the first failure and shows that tab's error.
  const saveAndLeave = async () => {
    for (const { tab: id, draft } of drafts) {
      if (!(await draft.save())) {
        openTab(id);
        return;
      }
    }
    resolveLeave(true);
  };
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
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => openTab(id)}
            className={cx(
              "flex items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-[0.8125rem] font-medium transition-colors sm:px-4",
              tab === id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
            {drafts.some(
              (entry) => entry.tab === id && entry.draft.changes.length > 0,
            ) && (
              <span aria-hidden className="size-1.5 rounded-full bg-accent" />
            )}
          </button>
        ))}
      </div>
      {visited.has("skills") && (
        <div
          className={
            tab === "skills" ? "flex min-h-0 flex-1 flex-col" : "hidden"
          }
        >
          <SkillsTab page={skills} />
        </div>
      )}
      {visited.has("tools") && (
        <div
          className={
            tab === "tools" ? "flex min-h-0 flex-1 flex-col" : "hidden"
          }
        >
          <ToolsTab />
        </div>
      )}
      <PersonalizationTab
        active={tab === "personalization"}
        draft={personalization}
      />
      {prompt === "leave" && (
        <UnsavedChangesModal
          title="Leave customization?"
          changes={changes}
          saving={personalization.saving || skills.saving}
          onStay={() => resolveLeave(false)}
          onDiscard={() => resolveLeave(true)}
          onSaveAndLeave={() => void saveAndLeave()}
        />
      )}
    </div>
  );
}
