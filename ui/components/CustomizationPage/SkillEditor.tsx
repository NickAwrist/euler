import { Save, Trash2 } from "lucide-react";
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useId,
} from "react";
import { normalizeSkillName } from "../../../src/schemas/skills";
import type { SkillData, SkillWriteBody } from "../../persist/skills";
import { cx, textareaClass } from "../../styles";
import { Button } from "../Button";
import type { SkillEditorErrors } from "./skillsPageUtils";

type Props = {
  isNew: boolean;
  skill: SkillData | null;
  editor: SkillWriteBody;
  setEditor: Dispatch<SetStateAction<SkillWriteBody>>;
  errors: SkillEditorErrors;
  saving: boolean;
  deleting: boolean;
  saveDisabled: boolean;
  onSave: () => void;
  onCancel: () => void;
  onDelete: (skill: SkillData) => void;
};

export function SkillEditor({
  isNew,
  skill,
  editor,
  setEditor,
  errors,
  saving,
  deleting,
  saveDisabled,
  onSave,
  onCancel,
  onDelete,
}: Props) {
  const id = useId();
  const errorId = (field: keyof SkillWriteBody) =>
    errors[field] ? `${id}-${field}-error` : undefined;

  return (
    <div className="ui-animate-fade-in mx-auto max-w-2xl px-6 py-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[1.125rem] font-semibold text-foreground">
          {isNew ? "New skill" : `Edit: $${skill?.name ?? ""}`}
        </h2>
        {skill && (
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            loading={deleting}
            onClick={() => onDelete(skill)}
            className="text-red-400 hover:bg-red-400/10 hover:text-red-300"
          >
            Delete
          </Button>
        )}
      </div>
      <p className="mb-6 max-w-xl text-[0.8125rem] leading-[1.55] text-muted-foreground">
        Agents see the name and description. They load the instructions only
        when the task matches, or when you type ${editor.name || "skill-name"}.
      </p>

      <div className="flex flex-col gap-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.75rem] font-medium text-muted-foreground">
            Name
          </span>
          <div
            className={cx(
              "flex rounded-lg border bg-background transition-colors",
              errors.name
                ? "border-red-400/60"
                : "border-border-subtle focus-within:border-border",
            )}
          >
            <span className="flex items-center border-r border-border-subtle px-3 font-mono text-[0.8125rem] text-muted-foreground">
              $
            </span>
            <input
              type="text"
              value={editor.name}
              onChange={(event) =>
                setEditor((current) => ({
                  ...current,
                  name: normalizeSkillName(event.target.value),
                }))
              }
              onBlur={() =>
                setEditor((current) => ({
                  ...current,
                  name: current.name.replace(/-+$/, ""),
                }))
              }
              placeholder="release-notes"
              maxLength={64}
              spellCheck={false}
              aria-invalid={errors.name !== undefined}
              aria-describedby={errorId("name")}
              className="min-w-0 flex-1 bg-transparent px-3 py-2 font-mono text-[0.8125rem] text-foreground outline-none placeholder:text-muted-foreground/50"
            />
          </div>
          <FieldHint id={errorId("name")} error={errors.name}>
            Lowercase letters, numbers, and hyphens. Up to 64 characters.
          </FieldHint>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[0.75rem] font-medium text-muted-foreground">
            Description
          </span>
          <textarea
            value={editor.description}
            onChange={(event) =>
              setEditor((current) => ({
                ...current,
                description: event.target.value,
              }))
            }
            placeholder="When this skill should be used and what it helps with."
            maxLength={500}
            rows={3}
            aria-invalid={errors.description !== undefined}
            aria-describedby={errorId("description")}
            className={cx(
              textareaClass,
              "text-[0.8125rem]",
              errors.description && "border-red-400/60!",
            )}
            style={{ resize: "vertical" }}
          />
          <FieldHint id={errorId("description")} error={errors.description}>
            This metadata lets the agent decide when to load the skill.
          </FieldHint>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[0.75rem] font-medium text-muted-foreground">
            Instructions
          </span>
          <textarea
            value={editor.instructions}
            onChange={(event) =>
              setEditor((current) => ({
                ...current,
                instructions: event.target.value,
              }))
            }
            placeholder={
              "# Workflow\n\nDescribe the steps, constraints, and output format for this skill."
            }
            rows={15}
            aria-invalid={errors.instructions !== undefined}
            aria-describedby={errorId("instructions")}
            className={cx(
              textareaClass,
              "font-mono text-[0.8125rem]",
              errors.instructions && "border-red-400/60!",
            )}
            style={{ resize: "vertical" }}
          />
          <FieldHint id={errorId("instructions")} error={errors.instructions}>
            Markdown body of the skill&apos;s SKILL.md file. The name and
            description above form its metadata.
          </FieldHint>
        </label>

        <div className="flex items-center gap-3 pt-2">
          <Button
            variant="primary"
            icon={Save}
            loading={saving}
            disabled={saveDisabled}
            onClick={onSave}
          >
            Save
          </Button>
          {!isNew && (
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldHint({
  id,
  error,
  children,
}: {
  id: string | undefined;
  error: string | undefined;
  children: ReactNode;
}) {
  return error ? (
    <span
      id={id}
      className="text-[0.6875rem] text-red-400 first-letter:uppercase"
    >
      {error}
    </span>
  ) : (
    <span className="text-[0.6875rem] text-muted-foreground">{children}</span>
  );
}
