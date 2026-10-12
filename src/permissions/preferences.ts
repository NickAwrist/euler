import { transaction } from "../db/connection";
import {
  effectiveUserPreferences,
  getUserPreferences,
  updateUserPreferences,
} from "../db/userPreferences";
import { OperationError } from "../observability/errors";
import type { ToolPermissionRule } from "../schemas/toolPermissions";

export function saveToolPermissionRule(
  owner: string,
  rule: ToolPermissionRule,
) {
  return transaction(() => {
    const { toolPermissions } = effectiveUserPreferences(owner);
    const rules = [
      ...toolPermissions.rules.filter((saved) => saved.id !== rule.id),
      rule,
    ];
    if (rules.length > 100)
      throw new OperationError("INVALID_REQUEST", {
        message:
          "Remove a tool permission rule before adding another; the limit is 100",
      });
    return updateUserPreferences(owner, { toolPermissions: { rules } });
  });
}

export function removeToolPermissionRule(owner: string, id: string) {
  return transaction(() => {
    const { toolPermissions } = effectiveUserPreferences(owner);
    return updateUserPreferences(owner, {
      toolPermissions: {
        rules: toolPermissions.rules.filter((rule) => rule.id !== id),
      },
    });
  });
}

/** Chat-scoped grants have no meaning after that chat is deleted. */
export function removeSessionToolPermissionRules(
  owner: string,
  sessionId: string,
): void {
  transaction(() => {
    const preferences = getUserPreferences(owner);
    if (!preferences) return;
    const rules = preferences.toolPermissions.rules.filter(
      (rule) => rule.sessionId !== sessionId,
    );
    if (rules.length !== preferences.toolPermissions.rules.length)
      updateUserPreferences(owner, { toolPermissions: { rules } });
  });
}
