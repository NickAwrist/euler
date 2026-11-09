import { type MessageInitShape, create } from "@bufbuild/protobuf";
import type { DisplayIcon } from "../../src/gen/euler/v1/common_pb";
import type { ToolPermissionRule } from "../../src/gen/euler/v1/permissions_pb";
import {
  type UpdatePreferencesRequestSchema,
  type UserPreferences,
  UserPreferencesSchema,
} from "../../src/gen/euler/v1/preferences_pb";
import { fromProtoField } from "../../src/permissions/wire";
import type { ToolPermissionField } from "../../src/schemas/toolPermissions";
import { preferenceClient, withErrorMessage } from "../lib/rpc";

export type { UserPreferences };

/** A tool for the rule editor, with its fields as plain values. */
export type ToolPermissionTool = {
  name: string;
  description: string;
  fields: ToolPermissionField[];
  icons: DisplayIcon[];
};
export type UserPreferencesPatch = MessageInitShape<
  typeof UpdatePreferencesRequestSchema
>;

// Replaced before the app renders; see UserPreferencesGate.
let preferences = create(UserPreferencesSchema);
export function getUserPreferences(): UserPreferences {
  return preferences;
}

export async function initializeUserPreferences(): Promise<void> {
  preferences = (await preferenceClient.getPreferences({})).preferences!;
}

let pending: Promise<unknown> = Promise.resolve();
/** Serializes writes that return the complete saved preferences. */
function savePreferences(
  write: () => Promise<{ preferences?: UserPreferences }>,
): Promise<UserPreferences> {
  const request = pending
    .catch(() => {})
    .then(async () => {
      const saved = (await write()).preferences;
      if (saved) preferences = saved;
      return preferences;
    });
  pending = request;
  return request;
}

export function updateUserPreferences(
  patch: UserPreferencesPatch,
): Promise<UserPreferences> {
  return savePreferences(() => preferenceClient.updatePreferences(patch));
}

export function saveToolPermissionRule(
  rule: ToolPermissionRule,
): Promise<UserPreferences> {
  return savePreferences(() => preferenceClient.putPermissionRule({ rule }));
}

export function deleteToolPermissionRule(
  ruleId: string,
): Promise<UserPreferences> {
  return savePreferences(() =>
    preferenceClient.deletePermissionRule({ ruleId }),
  );
}

/** Lists the tools currently available to agents, for rule pickers. */
export async function fetchToolPermissionTools(): Promise<
  ToolPermissionTool[]
> {
  return (
    await withErrorMessage(
      preferenceClient.listPermissionTools({}),
      "Failed to load tools",
    )
  ).tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    fields: tool.fields.map(fromProtoField),
    icons: tool.icons,
  }));
}

/** Caches a rule the server saved elsewhere, such as from an approval. */
export function rememberToolPermissionRule(rule: ToolPermissionRule) {
  preferences = {
    ...preferences,
    toolPermissionRules: [
      ...preferences.toolPermissionRules.filter(
        (saved) => saved.id !== rule.id,
      ),
      rule,
    ],
  };
}
