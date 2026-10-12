import type { z } from "zod";
import {
  type ToolPermissionRule,
  ToolPermissionRuleSchema,
  ToolPermissionToolsSchema,
} from "../../src/schemas/toolPermissions";
import {
  type UserPreferences,
  type UserPreferencesPatch,
  userPreferencesPatchSchema,
  userPreferencesSchema,
} from "../../src/schemas/userPreferences";
import { type ApiRequestOptions, userApiJson } from "../lib/api";

let preferences = userPreferencesSchema.parse({});
export function getUserPreferences(): UserPreferences {
  return preferences;
}

export async function initializeUserPreferences(): Promise<void> {
  preferences = userPreferencesSchema.parse(
    await userApiJson("/api/settings/user"),
  );
}

let pending: Promise<unknown> = Promise.resolve();
/** Serializes writes that return the complete saved preferences. */
function savePreferences(
  url: string,
  options: ApiRequestOptions,
): Promise<UserPreferences> {
  const request = pending
    .catch(() => {})
    .then(async () => {
      const saved: unknown = await userApiJson(url, options);
      preferences = userPreferencesSchema.parse(saved);
      return preferences;
    });
  pending = request;
  return request;
}

export function updateUserPreferences(
  patch: UserPreferencesPatch,
): Promise<UserPreferences> {
  return savePreferences("/api/settings/user", {
    method: "PATCH",
    json: userPreferencesPatchSchema.parse(patch),
  });
}

const toolPermissionRulePath = (id: string) =>
  `/api/settings/user/tool-permission-rules/${encodeURIComponent(id)}`;

export function saveToolPermissionRule(
  rule: ToolPermissionRule,
): Promise<UserPreferences> {
  return savePreferences(toolPermissionRulePath(rule.id), {
    method: "PUT",
    json: ToolPermissionRuleSchema.parse(rule),
  });
}

export function deleteToolPermissionRule(id: string): Promise<UserPreferences> {
  return savePreferences(toolPermissionRulePath(id), { method: "DELETE" });
}

export type ToolPermissionTool = z.infer<
  typeof ToolPermissionToolsSchema
>["tools"][number];

/** Lists the tools currently available to agents, for rule pickers. */
export async function fetchToolPermissionTools(): Promise<
  ToolPermissionTool[]
> {
  return ToolPermissionToolsSchema.parse(
    await userApiJson<unknown>("/api/settings/user/tools", {
      errorMessage: "Failed to load tools",
    }),
  ).tools;
}

/** Caches a rule the server saved elsewhere, such as from an approval. */
export function rememberToolPermissionRule(rule: ToolPermissionRule) {
  const { toolPermissions } = preferences;
  preferences = {
    ...preferences,
    toolPermissions: {
      ...toolPermissions,
      rules: [
        ...toolPermissions.rules.filter((saved) => saved.id !== rule.id),
        rule,
      ],
    },
  };
}
