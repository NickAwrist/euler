import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  type ToolPermissionField,
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
import {
  ALL_TOOLS,
  type ArgumentCondition,
  type FieldType,
  conditionFits,
  exactPattern,
  ruleFields,
  valueType,
} from "./toolPermissionFields";

type Action = ToolPermissionRule["action"];
type Condition = ToolPermissionRule["condition"];

const fieldClass =
  "h-8 rounded-md border border-border-subtle bg-surface px-2 text-[0.8125rem] text-foreground placeholder:text-muted-foreground transition-colors focus:border-border focus:outline-none";
const ACTIONS: { value: Action; label: string }[] = [
  { value: "allow", label: "Allow" },
  { value: "ask", label: "Ask" },
  { value: "deny", label: "Deny" },
];

const EMPTY_ARGUMENT: ArgumentCondition = {
  kind: "argument",
  field: "",
  match: "exact",
  value: "",
};
const fieldKey = (type: FieldType, path: string) => `${type}:${path}`;
const conditionType = (condition: Condition): FieldType =>
  condition.kind === "argument" ? valueType(condition.value) : "string";

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
  // An unset value has no type of its own, so the chosen field's type is kept.
  const [fieldType, setFieldType] = useState(() =>
    conditionType(rule.condition),
  );
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const parsed = ToolPermissionRuleSchema.safeParse(draft);
  const { condition } = draft;
  const fields = tools ? ruleFields(tools, draft.tool) : [];
  const field =
    condition.kind === "argument"
      ? fields.find(
          (option) =>
            option.path === condition.field && option.type === fieldType,
        )
      : undefined;
  // A saved condition stays valid after the tool's choices change, so editing
  // only the action does not force a new value. New conditions must fit.
  const savedCondition =
    !isNew &&
    draft.tool === rule.tool &&
    JSON.stringify(condition) === JSON.stringify(rule.condition);
  const valid =
    parsed.success &&
    (condition.kind !== "argument" ||
      !field ||
      savedCondition ||
      conditionFits(field, condition));
  // An empty pattern only needs filling in, so it is not reported as invalid.
  const patternError =
    condition.kind === "argument" &&
    condition.match === "regex" &&
    condition.value !== "" &&
    !parsed.success
      ? parsed.error.issues.find(
          (issue) =>
            issue.path[0] === "condition" && issue.path.at(-1) === "value",
        )?.message
      : undefined;
  // The server returns normalized rules, so compare the normalized draft.
  const dirty =
    isNew ||
    !parsed.success ||
    JSON.stringify(parsed.data) !== JSON.stringify(rule);
  const label = toolLabel(draft.tool);
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
  // A replaced condition has no chosen field, so its type resets too.
  const resetCondition = (next: Condition) => {
    setCondition(next);
    setFieldType(conditionType(next));
  };
  // A field condition only carries over to a tool with the same field.
  const changeTool = (tool: string) => {
    const next = tools ? ruleFields(tools, tool) : [];
    setDraft((current) => ({ ...current, tool }));
    if (condition.kind !== "argument") return;
    if (next.length === 0) return resetCondition({ kind: "any" });
    const fits = next.some(
      (option) => option.type === fieldType && conditionFits(option, condition),
    );
    if (!fits) resetCondition(EMPTY_ARGUMENT);
  };

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
            onChange={(event) => changeTool(event.target.value)}
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
              resetCondition(
                event.target.value === "argument"
                  ? EMPTY_ARGUMENT
                  : { kind: "any" },
              )
            }
          >
            <option value="any">Any arguments</option>
            <option
              value="argument"
              disabled={fields.length === 0 && condition.kind !== "argument"}
            >
              Field match
            </option>
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
        <ArgumentFields
          condition={condition}
          fields={fields}
          field={field}
          fieldType={fieldType}
          known={tools !== null}
          patternError={patternError}
          onFieldChange={(next) => {
            setFieldType(next.type);
            setCondition({ ...EMPTY_ARGUMENT, field: next.path });
          }}
          onChange={setCondition}
        />
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
              onClick={() => {
                setDraft(rule);
                setFieldType(conditionType(rule.condition));
              }}
            >
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            loading={busy === "save"}
            disabled={!valid || busy !== null}
            onClick={() => {
              if (valid) void run("save", () => onSave(parsed.data));
            }}
          >
            Save rule
          </Button>
        </div>
      )}
    </fieldset>
  );
}

/** Field, match, and value controls for a field condition. */
function ArgumentFields({
  condition,
  fields,
  field,
  fieldType,
  known,
  patternError,
  onFieldChange,
  onChange,
}: {
  condition: ArgumentCondition;
  fields: ToolPermissionField[];
  /** The tool field the condition names, if the tool still offers it. */
  field: ToolPermissionField | undefined;
  fieldType: FieldType;
  /** Whether the tool catalogue loaded, so a missing field is unavailable. */
  known: boolean;
  patternError: string | undefined;
  onFieldChange: (field: ToolPermissionField) => void;
  onChange: (condition: ArgumentCondition) => void;
}) {
  const current = condition.field ? fieldKey(fieldType, condition.field) : "";
  // A path with several types (All tools) is labelled with each type.
  const typed = (option: ToolPermissionField) =>
    fields.filter((other) => other.path === option.path).length > 1
      ? `${option.path} (${option.type})`
      : option.path;
  const values =
    field?.values ?? (fieldType === "boolean" ? [true, false] : undefined);
  const setValue = (value: ArgumentCondition["value"]) =>
    onChange({ ...condition, value });
  // Switching to Regex anchors the value so the rule still matches the same
  // calls. A pattern is not a value, so switching back requires a new one.
  const setMatch = (match: ArgumentCondition["match"]) => {
    if (match === condition.match) return;
    const value =
      match === "regex" && typeof condition.value === "string"
        ? exactPattern(condition.value)
        : "";
    onChange({ ...condition, match, value });
  };
  const errorId = useId();

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <select
        aria-label="Field"
        className={cx(fieldClass, "w-40")}
        value={current}
        onChange={(event) => {
          const next = fields.find(
            (option) =>
              fieldKey(option.type, option.path) === event.target.value,
          );
          if (next) onFieldChange(next);
        }}
      >
        {current === "" && (
          <option value="" disabled>
            Field
          </option>
        )}
        {fields.map((option) => {
          const key = fieldKey(option.type, option.path);
          return (
            <option key={key} value={key} title={option.description}>
              {typed(option)}
            </option>
          );
        })}
        {current !== "" && !field && (
          <option value={current}>
            {known ? `${condition.field} (unavailable)` : condition.field}
          </option>
        )}
      </select>
      <select
        aria-label="Match"
        className={fieldClass}
        value={condition.match}
        onChange={(event) =>
          setMatch(event.target.value === "regex" ? "regex" : "exact")
        }
      >
        <option value="exact">Equals</option>
        {fieldType === "string" && <option value="regex">Regex</option>}
      </select>
      {condition.match === "regex" ? (
        <input
          aria-label="Pattern"
          placeholder="^npm\s+publish\b"
          aria-invalid={patternError !== undefined}
          aria-describedby={patternError ? errorId : undefined}
          className={cx(fieldClass, "min-w-40 flex-1 font-mono")}
          value={typeof condition.value === "string" ? condition.value : ""}
          onChange={(event) => setValue(event.target.value)}
        />
      ) : values ? (
        <select
          aria-label="Value"
          className={cx(fieldClass, "min-w-40 flex-1 font-mono")}
          value={String(values.indexOf(condition.value))}
          onChange={(event) => {
            const value = values[Number(event.target.value)];
            if (value !== undefined) setValue(value);
          }}
        >
          {/* A saved value the field no longer offers stays shown as is. */}
          {!values.includes(condition.value) && (
            <option value="-1" disabled>
              {condition.value === ""
                ? "Value"
                : `${String(condition.value)} (unavailable)`}
            </option>
          )}
          {values.map((value, index) => (
            <option key={String(index)} value={String(index)}>
              {String(value)}
            </option>
          ))}
        </select>
      ) : fieldType === "number" ? (
        <input
          aria-label="Value"
          type="number"
          placeholder="Value"
          className={cx(fieldClass, "min-w-40 flex-1 font-mono")}
          value={typeof condition.value === "number" ? condition.value : ""}
          onChange={(event) => {
            const value = event.target.valueAsNumber;
            setValue(Number.isFinite(value) ? value : "");
          }}
        />
      ) : (
        <input
          aria-label="Value"
          placeholder="Value"
          className={cx(fieldClass, "min-w-40 flex-1 font-mono")}
          value={typeof condition.value === "string" ? condition.value : ""}
          onChange={(event) => setValue(event.target.value)}
        />
      )}
      {patternError && (
        <p id={errorId} className="basis-full text-[0.75rem] text-red-400">
          {patternError}
        </p>
      )}
    </div>
  );
}
