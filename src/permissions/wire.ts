import { type JsonObject, create, fromJson, toJson } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import {
  ToolPermissionCondition_Argument_Match,
  type ToolPermissionRule,
  ToolPermissionRuleSchema,
  ToolPermissionRule_Action,
} from "../gen/euler/v1/permissions_pb";
import {
  type PermissionField,
  PermissionField_Type,
} from "../gen/euler/v1/preferences_pb";
import type {
  ToolPermissionRule as DomainRule,
  ToolPermissionField,
} from "../schemas/toolPermissions";

// Tool permission rules as the API carries them and as they are stored and
// edited. Shared by the server's handlers and the web's rule editor.

const ACTIONS = {
  allow: ToolPermissionRule_Action.ALLOW,
  deny: ToolPermissionRule_Action.DENY,
  ask: ToolPermissionRule_Action.ASK,
} as const;

const FIELD_TYPES = {
  [PermissionField_Type.STRING]: "string",
  [PermissionField_Type.NUMBER]: "number",
  [PermissionField_Type.BOOLEAN]: "boolean",
} as const;

export function toProtoRule(value: DomainRule): ToolPermissionRule {
  const { condition } = value;
  return create(ToolPermissionRuleSchema, {
    id: value.id,
    tool: value.tool,
    action: ACTIONS[value.action],
    condition: {
      kind:
        condition.kind === "any"
          ? { case: "any", value: {} }
          : condition.kind === "arguments"
            ? {
                case: "arguments",
                value: { value: condition.value as JsonObject },
              }
            : {
                case: "argument",
                value: {
                  field: condition.field,
                  match:
                    condition.match === "regex"
                      ? ToolPermissionCondition_Argument_Match.REGEX
                      : ToolPermissionCondition_Argument_Match.EXACT,
                  value: fromJson(ValueSchema, condition.value),
                },
              },
    },
    sessionId: value.sessionId,
    workspacePath: value.workspacePath,
  });
}

/**
 * A rule in the stored shape. Unchecked: the server validates it with
 * ToolPermissionRuleSchema before saving.
 */
export function fromProtoRule(value: ToolPermissionRule): DomainRule {
  const condition = value.condition?.kind;
  const action =
    value.action === ToolPermissionRule_Action.DENY
      ? "deny"
      : value.action === ToolPermissionRule_Action.ASK
        ? "ask"
        : "allow";
  return {
    id: value.id,
    tool: value.tool,
    action,
    condition:
      condition?.case === "arguments"
        ? {
            kind: "arguments",
            value: (condition.value.value ?? {}) as DomainArguments,
          }
        : condition?.case === "argument"
          ? ({
              kind: "argument",
              field: condition.value.field,
              match:
                condition.value.match ===
                ToolPermissionCondition_Argument_Match.REGEX
                  ? "regex"
                  : "exact",
              value: condition.value.value
                ? toJson(ValueSchema, condition.value.value)
                : "",
            } as DomainRule["condition"])
          : { kind: "any" },
    ...(value.sessionId === undefined ? {} : { sessionId: value.sessionId }),
    ...(value.workspacePath === undefined
      ? {}
      : { workspacePath: value.workspacePath }),
  };
}

type DomainArguments = Extract<
  DomainRule["condition"],
  { kind: "arguments" }
>["value"];

export function fromProtoField(value: PermissionField): ToolPermissionField {
  return {
    path: value.path,
    type: FIELD_TYPES[value.type as keyof typeof FIELD_TYPES] ?? "string",
    ...(value.description === undefined
      ? {}
      : { description: value.description }),
    ...(value.values.length
      ? {
          values: value.values.map(
            (entry) => toJson(ValueSchema, entry) as string | number | boolean,
          ),
        }
      : {}),
  };
}
