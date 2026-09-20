import { useState } from "react";
import { cx } from "../../styles";
import { BackToChatButton } from "../BackToChatButton";
import { TruncateConfirmModal } from "../TruncateConfirmModal";
import { AgentEditor } from "./AgentEditor";
import { AgentList } from "./AgentList";
import { SkillsPanel } from "./SkillsPanel";
import { PROTECTED_AGENT_NAME, emptyEditor } from "./agentsPageUtils";
import { useAgentsPage } from "./useAgentsPage";

type CustomizationTab = "agents" | "skills";

export function AgentsPage({
  defaultRunAgent,
  onDefaultRunAgentChange,
  onBack,
}: {
  defaultRunAgent: string;
  onDefaultRunAgentChange: (name: string) => void;
  onBack: () => void;
}) {
  const p = useAgentsPage({ defaultRunAgent, onDefaultRunAgentChange });
  const [tab, setTab] = useState<CustomizationTab>("agents");
  const tabButtonClass = (value: CustomizationTab) =>
    cx(
      "rounded-t-md border-b-2 px-4 py-2 text-[0.8125rem] font-medium transition-colors",
      tab === value
        ? "border-foreground text-foreground"
        : "border-transparent text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border-subtle px-5 py-3">
        <BackToChatButton onClick={onBack} />
        <div className="h-4 w-px bg-border-subtle" />
        <h1 className="text-[0.9375rem] font-semibold text-foreground">
          Customization
        </h1>
      </header>

      <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-border-subtle px-3 sm:px-5">
        <button
          type="button"
          className={tabButtonClass("agents")}
          onClick={() => {
            setTab("agents");
            void p.refreshSelectedEditor();
          }}
        >
          Agents
        </button>
        <button
          type="button"
          className={tabButtonClass("skills")}
          onClick={() => setTab("skills")}
        >
          Skills
        </button>
      </div>

      {tab === "skills" ? (
        <SkillsPanel />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border-subtle bg-muted/20 px-5 py-3">
            <label className="flex items-center gap-2 text-[0.8125rem] text-muted-foreground">
              <span className="text-foreground">Default agent</span>
              <select
                value={p.defaultDraft}
                disabled={p.defaultSaving || p.agents.length === 0}
                onChange={(event) =>
                  p.handleDefaultAgentChange(event.target.value)
                }
                className="cursor-pointer rounded-lg border border-border-subtle bg-background px-2.5 py-1.5 text-[0.8125rem] text-foreground outline-none focus:border-border disabled:cursor-not-allowed disabled:opacity-50"
              >
                {p.agents.map((agent) => (
                  <option key={agent.id} value={agent.name}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {p.error && (
            <div className="shrink-0 border-b border-red-400/20 bg-red-400/5 px-5 py-2.5 text-[0.8125rem] text-red-400">
              {p.error}
            </div>
          )}

          <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] max-[700px]:grid-cols-1">
            <AgentList
              agents={p.agents}
              selectedId={p.selectedId}
              isNew={p.isNew}
              openMenu={p.openMenu}
              setOpenMenu={p.setOpenMenu}
              deleting={p.deleting}
              onSelectAgent={p.selectAgent}
              onStartNew={p.startNew}
              onRequestDeleteAgent={p.requestDeleteAgent}
            />

            <div className="min-h-0 overflow-y-auto">
              {p.showEditor ? (
                <AgentEditor
                  isNew={p.isNew}
                  selectedAgent={p.selectedAgent}
                  editor={p.editor}
                  setEditor={p.setEditor}
                  builtinTools={p.builtinTools}
                  skills={p.skills}
                  otherAgents={p.otherAgents}
                  saving={p.saving}
                  saveDisabled={!p.editorDirty || p.saving}
                  deleting={p.deleting}
                  onSave={() => void p.handleSave()}
                  onCancelEdit={() => {
                    p.setSelectedId(null);
                    p.setIsNew(false);
                    p.setEditor(emptyEditor());
                  }}
                  onToggleTool={p.toggleTool}
                  onToggleSkill={p.toggleSkill}
                  onToggleDelegation={p.toggleDelegation}
                  onRequestDeleteAgent={p.requestDeleteAgent}
                />
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-center">
                  <p className="text-[0.875rem] text-muted-foreground">
                    Select an agent or create a new one
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {p.pendingDelete && (
        <TruncateConfirmModal
          title="Delete this agent?"
          description={`Remove "${p.pendingDelete.name}" from your agents. Sessions that used it will switch to ${PROTECTED_AGENT_NAME}. This cannot be undone.`}
          confirmLabel="Delete"
          busyConfirmLabel="Deleting..."
          busy={p.deleting}
          onClose={() => p.setPendingDelete(null)}
          onConfirm={() => void p.performDelete()}
        />
      )}
    </div>
  );
}
