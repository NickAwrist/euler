import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  type ToolPermissionRule,
  ToolPermissionRuleSchema,
  type ToolPermissions,
} from "../../../src/schemas/toolPermissions";
import { createBrowserUuid } from "../../persist/userIdentity";
import {
  deleteToolPermissionRule,
  getUserPreferences,
  saveToolPermissionRule,
  updateUserPreferences,
} from "../../persist/userPreferences";
import { cx, eyebrowText } from "../../styles";
import { Button } from "../Button";
import { IconButton } from "../IconButton";
import { SegmentedControl } from "../SegmentedControl";
import { ShellRuleNote } from "../ShellRuleNote";

type Action = ToolPermissionRule["action"];
type Condition = ToolPermissionRule["condition"];

const fieldClass =
  "h-8 rounded-md border border-border-subtle bg-surface px-2 text-[0.8125rem] text-foreground placeholder:text-muted-foreground transition-colors focus:border-border focus:outline-none";
const ACTIONS: { value: Action; label: string }[] = [
  { value: "allow", label: "Allow" },
  { value: "ask", label: "Ask" },
  { value: "deny", label: "Deny" },
];

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/** Default tool access plus per-tool rules that allow, ask, or deny calls. */
export function ToolPermissionsSection() {
  const [permissions, setPermissions] = useState<ToolPermissions>(
    () => getUserPreferences().toolPermissions,
  );
  const [drafts, setDrafts] = useState<ToolPermissionRule[]>([]);
  const [error, setError] = useState<string | null>(null);

  const setDefaultAction = (
    defaultAction: ToolPermissions["defaultAction"],
  ) => {
    const previous = permissions.defaultAction;
    setError(null);
    setPermissions((current) => ({ ...current, defaultAction }));
    updateUserPreferences({ toolPermissions: { defaultAction } })
      .then((saved) => setPermissions(saved.toolPermissions))
      .catch((saveError: unknown) => {
        setPermissions((current) => ({
          ...current,
          defaultAction: previous,
        }));
        setError(errorMessage(saveError, "Failed to save default"));
      });
  };

  const save = async (rule: ToolPermissionRule) => {
    const saved = await saveToolPermissionRule(rule);
    setPermissions(saved.toolPermissions);
    setDrafts((current) => current.filter((draft) => draft.id !== rule.id));
  };

  const remove = async (id: string) => {
    if (drafts.some((draft) => draft.id === id)) {
      setDrafts((current) => current.filter((draft) => draft.id !== id));
      return;
    }
    const saved = await deleteToolPermissionRule(id);
    setPermissions(saved.toolPermissions);
  };

  const rules = [...permissions.rules, ...drafts];
  return (
    <section aria-labelledby="tool-permissions" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="tool-permissions" className={eyebrowText}>
          Tool permissions
        </h2>
        <Button
          size="sm"
          variant="secondary"
          icon={Plus}
          onClick={() =>
            setDrafts((current) => [
              ...current,
              {
                id: createBrowserUuid(),
                tool: "",
                action: "ask",
                condition: { kind: "any" },
              },
            ])
          }
        >
          Add rule
        </Button>
      </div>
      <SegmentedControl
        label="Default tool access"
        value={permissions.defaultAction}
        onChange={setDefaultAction}
        options={[
          { value: "allow", label: "Allow" },
          { value: "ask", label: "Ask before every tool call" },
        ]}
      />
      <p className="text-[0.75rem] leading-[1.5] text-muted-foreground">
        Deny rules always win. Otherwise the most specific matching rule
        applies, with chat and workspace rules before global ones and newer
        rules breaking ties.
      </p>
      <ShellRuleNote />
      {error && (
        <p role="alert" className="text-[0.75rem] text-red-400">
          {error}
        </p>
      )}
      {rules.length === 0 && (
        <p className="text-[0.8125rem] text-muted-foreground">
          No rules yet. Every tool call uses the default.
        </p>
      )}
      {rules.map((rule) => (
        <RuleRow
          key={rule.id}
          rule={rule}
          isNew={drafts.some((draft) => draft.id === rule.id)}
          onSave={save}
          onDelete={() => remove(rule.id)}
        />
      ))}
    </section>
  );
}

function RuleRow({
  rule,
  isNew,
  onSave,
  onDelete,
}: {
  rule: ToolPermissionRule;
  isNew: boolean;
  onSave: (rule: ToolPermissionRule) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(rule);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parsed = ToolPermissionRuleSchema.safeParse(draft);
  // The server returns normalized rules, so compare the normalized draft.
  const dirty =
    isNew ||
    !parsed.success ||
    JSON.stringify(parsed.data) !== JSON.stringify(rule);
  const label = draft.tool.trim() || "new rule";
  const { condition } = draft;

  const run = async (kind: "save" | "delete", action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(
        errorMessage(
          actionError,
          kind === "save" ? "Failed to save rule" : "Failed to delete rule",
        ),
      );
    }
    setBusy(null);
  };
  const setCondition = (next: Condition) =>
    setDraft((current) => ({ ...current, condition: next }));

  return (
    <fieldset
      aria-label={`Rule for ${label}`}
      className="rounded-lg border border-border-subtle px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-2">
        {condition.kind === "arguments" ? (
          <code className="font-mono text-[0.8125rem] text-foreground">
            {draft.tool}
          </code>
        ) : (
          <input
            aria-label="Tool name"
            placeholder="Tool name, such as bash"
            className={cx(fieldClass, "w-40 flex-1")}
            value={draft.tool}
            onChange={(event) =>
              setDraft((current) => ({ ...current, tool: event.target.value }))
            }
          />
        )}
        {condition.kind !== "arguments" && (
          <select
            aria-label="Arguments"
            className={fieldClass}
            value={condition.kind}
            onChange={(event) =>
              setCondition(
                event.target.value === "argument"
                  ? { kind: "argument", field: "", match: "exact", value: "" }
                  : { kind: "any" },
              )
            }
          >
            <option value="any">Any arguments</option>
            <option value="argument">Argument field</option>
          </select>
        )}
        <select
          aria-label="Action"
          className={fieldClass}
          value={draft.action}
          onChange={(event) => {
            const action = ACTIONS.find(
              (option) => option.value === event.target.value,
            )?.value;
            if (action) setDraft((current) => ({ ...current, action }));
          }}
        >
          {ACTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <IconButton
          size="sm"
          variant="danger"
          icon={Trash2}
          label={`Delete rule for ${label}`}
          loading={busy === "delete"}
          disabled={busy !== null}
          onClick={() => void run("delete", onDelete)}
        />
      </div>
      {condition.kind === "argument" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            aria-label="Argument field"
            placeholder="Field, such as command"
            className={cx(fieldClass, "w-36")}
            value={condition.field}
            onChange={(event) =>
              setCondition({ ...condition, field: event.target.value })
            }
          />
          <select
            aria-label="Match"
            className={fieldClass}
            value={condition.match}
            onChange={(event) =>
              setCondition({
                ...condition,
                match: event.target.value === "prefix" ? "prefix" : "exact",
              })
            }
          >
            <option value="exact">Equals</option>
            <option value="prefix">Starts with</option>
          </select>
          <input
            aria-label="Argument value"
            placeholder="Value"
            className={cx(fieldClass, "min-w-40 flex-1 font-mono")}
            value={condition.value}
            onChange={(event) =>
              setCondition({ ...condition, value: event.target.value })
            }
          />
        </div>
      )}
      {condition.kind === "arguments" && (
        <pre
          aria-label="Exact arguments"
          className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded bg-muted px-2 py-1.5 font-mono text-[0.6875rem] text-foreground"
        >
          {JSON.stringify(condition.value, null, 2)}
        </pre>
      )}
      {(draft.sessionId || draft.workspacePath) && (
        <p className="mt-1.5 truncate text-[0.6875rem] text-muted-foreground">
          Only in{" "}
          {[
            draft.sessionId && "one chat",
            draft.workspacePath && `workspace ${draft.workspacePath}`,
          ]
            .filter(Boolean)
            .join(" and ")}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-[0.75rem] text-red-400">
          {error}
        </p>
      )}
      {dirty && (
        <div className="mt-2 flex justify-end gap-2">
          {!isNew && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => setDraft(rule)}
            >
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            loading={busy === "save"}
            disabled={!parsed.success || busy !== null}
            onClick={() => {
              if (parsed.success) void run("save", () => onSave(parsed.data));
            }}
          >
            Save rule
          </Button>
        </div>
      )}
    </fieldset>
  );
}
