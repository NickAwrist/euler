import { useEffect, useState } from "react";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";
import type { UserSettings } from "../../persist/userSettings";
import type { CustomizationTab, Personalization } from "../../types";
import { BackToChatButton } from "../BackToChatButton";
import { PageTabRail } from "../PageTabRail";
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

export function CustomizationPage({
  tab,
  onTabChange: openTab,
  onBack,
  currentSettings,
  onSave,
}: {
  tab: CustomizationTab;
  onTabChange: (tab: CustomizationTab) => void;
  onBack: () => void;
  currentSettings: UserSettings;
  onSave: (settings: Partial<Personalization>) => Promise<void>;
}) {
  const [failedTab, setFailedTab] = useState<CustomizationTab | null>(null);
  // Let the rejected departure settle before navigating to its failing draft.
  useEffect(() => {
    if (failedTab === null) return;
    openTab(failedTab);
    setFailedTab(null);
  }, [failedTab, openTab]);
  // Tabs mount on first visit and stay mounted to keep their state.
  const [visited, setVisited] = useState<ReadonlySet<CustomizationTab>>(
    () => new Set([tab]),
  );
  if (!visited.has(tab)) setVisited(new Set(visited).add(tab));
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
  const { prompt, resolveLeave } = useUnsavedChanges(
    changes.length > 0,
    "/customization/",
  );
  // Stops at the first failure and shows that tab's error.
  const saveAndLeave = async () => {
    for (const { tab: id, draft } of drafts) {
      if (!(await draft.save())) {
        resolveLeave(false);
        setFailedTab(id);
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
      <PageTabRail
        label="Customization sections"
        tabs={TABS}
        activeTab={tab}
        onTabChange={openTab}
        dirtyTabs={drafts
          .filter(({ draft }) => draft.changes.length > 0)
          .map(({ tab }) => tab)}
      />
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
