import { BookOpen, Bot, Save, Trash2, Wrench } from "lucide-react";
import { type Dispatch, type SetStateAction, useRef } from "react";
import { PROMPT_PLACEHOLDER_LIST } from "../../../src/prompts/render";
import type { AgentData } from "../../persist/agents";
import type { SkillData } from "../../persist/skills";
import { Button } from "../Button";
import { MultiSelectChips } from "../MultiSelectChips";
import { canDeleteAgent } from "./agentsPageUtils";
import type { AgentEditorState } from "./types";

type Props = {
  isNew: boolean;
  selectedAgent: AgentData | null;
  editor: AgentEditorState;
  setEditor: Dispatch<SetStateAction<AgentEditorState>>;
  builtinTools: string[];
  skills: SkillData[];
  otherAgents: AgentData[];
  saving: boolean;
  saveDisabled: boolean;
  deleting: boolean;
  onSave: () => void;
  onCancelEdit: () => void;
  onToggleTool: (tool: string) => void;
  onToggleSkill: (skillId: string) => void;
  onToggleDelegation: (agentId: string) => void;
  onRequestDeleteAgent: (a: AgentData) => void;
};

function insertAtCaret(
  textarea: HTMLTextAreaElement | null,
  current: string,
  token: string,
): { next: string; caret: number } {
  const fallback = `${current}${current.length && !current.endsWith("\n") ? "\n\n" : ""}${token}`;
  if (!textarea) {
    return { next: fallback, caret: fallback.length };
  }
  const start = textarea.selectionStart ?? current.length;
  const end = textarea.selectionEnd ?? current.length;
  const before = current.slice(0, start);
  const after = current.slice(end);
  const next = `${before}${token}${after}`;
  return { next, caret: before.length + token.length };
}

export function AgentEditor({
  isNew,
  selectedAgent,
  editor,
  setEditor,
  builtinTools,
  skills,
  otherAgents,
  saving,
  saveDisabled,
  deleting,
  onSave,
  onCancelEdit,
  onToggleTool,
  onToggleSkill,
  onToggleDelegation,
  onRequestDeleteAgent,
}: Props) {
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  const insertPlaceholder = (token: string) => {
    const { next, caret } = insertAtCaret(
      promptRef.current,
      editor.system_prompt,
      token,
    );
    setEditor((prev) => ({ ...prev, system_prompt: next }));
    queueMicrotask(() => {
      const el = promptRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  };

  return (
    <div className="ui-animate-fade-in mx-auto max-w-2xl px-6 py-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-[1.125rem] font-semibold text-foreground">
          {isNew ? "New Agent" : `Edit: ${selectedAgent?.name ?? ""}`}
        </h2>
        {selectedAgent && canDeleteAgent(selectedAgent) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onRequestDeleteAgent(selectedAgent)}
            disabled={deleting}
            loading={deleting}
            icon={Trash2}
            className="text-red-400 hover:bg-red-400/10 hover:text-red-300"
          >
            Delete
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.75rem] font-medium text-muted-foreground">
            Name
          </span>
          <input
            type="text"
            value={editor.name}
            onChange={(e) => setEditor((p) => ({ ...p, name: e.target.value }))}
            placeholder="my_agent"
            className="rounded-lg border border-border-subtle bg-background px-3 py-2 text-[0.8125rem] text-foreground outline-none transition-colors focus:border-border placeholder:text-muted-foreground/50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[0.75rem] font-medium text-muted-foreground">
            Description
          </span>
          <textarea
            value={editor.description}
            onChange={(e) =>
              setEditor((p) => ({ ...p, description: e.target.value }))
            }
            placeholder="What this agent does..."
            rows={2}
            className="rounded-lg border border-border-subtle bg-background px-3 py-2 text-[0.8125rem] text-foreground outline-none transition-colors focus:border-border placeholder:text-muted-foreground/50"
            style={{ resize: "vertical" }}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[0.75rem] font-medium text-muted-foreground">
            System Prompt
          </span>
          <textarea
            ref={promptRef}
            value={editor.system_prompt}
            onChange={(e) =>
              setEditor((p) => ({ ...p, system_prompt: e.target.value }))
            }
            placeholder="Instructions for the agent..."
            rows={6}
            className="rounded-lg border border-border-subtle bg-background px-3 py-2.5 text-[0.8125rem] leading-[1.6] text-foreground outline-none transition-colors focus:border-border placeholder:text-muted-foreground/50 font-mono"
            style={{ resize: "vertical" }}
          />
          <div className="mt-1 flex flex-col gap-1.5 rounded-md border border-border-subtle bg-muted/15 px-3 py-2">
            <span className="text-[0.7rem] font-medium text-muted-foreground">
              Placeholders (click to insert)
            </span>
            <div className="flex flex-wrap gap-1.5">
              {PROMPT_PLACEHOLDER_LIST.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  title={p.description}
                  onClick={() => insertPlaceholder(p.token)}
                  className="rounded-md border border-border-subtle bg-background px-2 py-0.5 font-mono text-[0.7rem] text-foreground transition-colors hover:border-border hover:bg-accent-soft-strong"
                >
                  {p.token}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-0.5 text-[0.68rem] leading-snug text-muted-foreground">
              {PROMPT_PLACEHOLDER_LIST.map((p) => (
                <span key={p.key}>
                  <code className="font-mono text-[0.7rem] text-foreground/80">
                    {p.token}
                  </code>{" "}
                  - {p.description}
                </span>
              ))}
            </div>
          </div>
        </div>

        <MultiSelectChips
          label="Tools"
          icon={Wrench}
          items={builtinTools}
          selected={editor.tools}
          getId={(tool) => tool}
          getLabel={(tool) => tool}
          onToggle={onToggleTool}
        />

        <MultiSelectChips
          label="Skills"
          icon={BookOpen}
          items={skills}
          selected={editor.skill_ids}
          getId={(skill) => skill.id}
          getLabel={(skill) => `$${skill.name}`}
          onToggle={onToggleSkill}
          helpText="This agent sees and can load only the selected skills."
        />

        <MultiSelectChips
          label="Delegation routes"
          icon={Bot}
          items={otherAgents}
          selected={editor.delegate_agent_ids}
          getId={(agent) => agent.id}
          getLabel={(agent) => agent.name}
          onToggle={onToggleDelegation}
          helpText="Selected agents appear to the model as callable delegation tools."
        />

        <div className="flex items-center gap-3 pt-2">
          <Button
            variant="primary"
            onClick={onSave}
            disabled={saveDisabled}
            loading={saving}
            icon={Save}
          >
            Save
          </Button>
          {!isNew && (
            <Button variant="secondary" onClick={onCancelEdit}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
