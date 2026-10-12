import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type ToolPermissionRule,
  ToolPermissionRuleSchema,
  type ToolPermissions,
} from "../../../src/schemas/toolPermissions";
import { createBrowserUuid } from "../../persist/userIdentity";
import {
  type ToolPermissionTool,
  deleteToolPermissionRule,
  fetchToolPermissionTools,
  getUserPreferences,
  saveToolPermissionRule,
} from "../../persist/userPreferences";
import { cx, eyebrowText } from "../../styles";
import { Button } from "../Button";
import { IconButton } from "../IconButton";

type Action = ToolPermissionRule["action"];
type Condition = ToolPermissionRule["condition"];

const fieldClass =
  "h-8 rounded-md border border-border-subtle bg-surface px-2 text-[0.8125rem] text-foreground placeholder:text-muted-foreground transition-colors focus:border-border focus:outline-none";
const ACTIONS: { value: Action; label: string }[] = [
  { value: "allow", label: "Allow" },
  { value: "ask", label: "Ask" },
  { value: "deny", label: "Deny" },
];

/** Rule tool that matches every tool. */
const ALL_TOOLS = "*";

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;
const toolLabel = (tool: string) =>
  tool === ALL_TOOLS ? "All tools" : tool.trim() || "new rule";

/** Per-tool rules that allow, ask, or deny calls. */
export function ToolPermissionsSection() {
  const [permissions, setPermissions] = useState<ToolPermissions>(
    () => getUserPreferences().toolPermissions,
  );
  const [drafts, setDrafts] = useState<ToolPermissionRule[]>([]);
  const [tools, setTools] = useState<ToolPermissionTool[] | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);

  const toolsRequest = useRef(0);

  // Capabilities and MCP servers change the catalogue, so Add rule reloads it.
  // Only the latest request applies, so a slow older response cannot win.
  const loadTools = useCallback(() => {
    const request = ++toolsRequest.current;
    fetchToolPermissionTools()
      .then((loaded) => {
        if (request !== toolsRequest.current) return;
        setTools(loaded);
        setToolsError(null);
      })
      .catch((loadError: unknown) => {
        if (request !== toolsRequest.current) return;
        setToolsError(errorMessage(loadError, "Failed to load tools"));
      });
  }, []);
  useEffect(loadTools, [loadTools]);

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
          onClick={() => {
            loadTools();
            setDrafts((current) => [
              ...current,
              {
                id: createBrowserUuid(),
                tool: "",
                action: "ask",
                condition: { kind: "any" },
              },
            ]);
          }}
        >
          Add rule
        </Button>
      </div>
      {toolsError && (
        <p role="alert" className="text-[0.75rem] text-red-400">
          {toolsError}
        </p>
      )}
      {rules.length === 0 && (
        <p className="text-[0.8125rem] text-muted-foreground">No rules.</p>
      )}
      {rules.map((rule) => (
        <RuleRow
          key={rule.id}
          rule={rule}
          tools={tools}
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
  tools,
  isNew,
  onSave,
  onDelete,
}: {
  rule: ToolPermissionRule;
  tools: ToolPermissionTool[] | null;
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
  const label = toolLabel(draft.tool);
  const { condition } = draft;
  // Keep a saved tool that is no longer offered instead of switching it.
  const missing =
    draft.tool !== "" &&
    draft.tool !== ALL_TOOLS &&
    !tools?.some((tool) => tool.name === draft.tool);

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
          <select
            aria-label="Tool"
            className={cx(fieldClass, "w-40 flex-1")}
            value={draft.tool}
            onChange={(event) => {
              const tool = event.target.value;
              setDraft((current) => ({ ...current, tool }));
            }}
          >
            {draft.tool === "" && (
              <option value="" disabled>
                Tool
              </option>
            )}
            <option value={ALL_TOOLS}>All tools</option>
            {tools?.map((tool) => (
              <option
                key={tool.name}
                value={tool.name}
                title={tool.description}
              >
                {tool.name}
              </option>
            ))}
            {missing && (
              <option value={draft.tool}>
                {tools ? `${draft.tool} (unavailable)` : draft.tool}
              </option>
            )}
          </select>
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
            <option value="argument">Field match</option>
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
            aria-label="Field"
            placeholder="Field"
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
            aria-label="Value"
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
