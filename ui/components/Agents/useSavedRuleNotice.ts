import { useEffect, useState } from "react";
import type { ToolPermissionRule } from "../../../src/schemas/toolPermissions";
import { whileRunning } from "../../lib/whileRunning";
import {
  deleteToolPermissionRule,
  rememberToolPermissionRule,
} from "../../persist/userPreferences";

export type SavedRule = {
  sessionId: string;
  rule: ToolPermissionRule;
  scope: string;
  undone: boolean;
  undoError: string;
};

export type SavedRuleNotice = ReturnType<typeof useSavedRuleNotice>;

const SAVED_NOTICE_MS = 10_000;

/**
 * The "Saved: allow matching calls" notice for a chat. It outlives the
 * approval that created it, so the chat owns it rather than the approval list.
 */
export function useSavedRuleNotice(sessionId: string | null) {
  const [saved, setSaved] = useState<SavedRule | null>(null);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    if (!saved) return;
    if (saved.sessionId !== sessionId) {
      setSaved(null);
      return;
    }
    if (undoing || saved.undoError) return;
    const timer = setTimeout(() => setSaved(null), SAVED_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [saved, sessionId, undoing]);

  const save = (
    savedSessionId: string,
    rule: ToolPermissionRule,
    scope: string,
  ) => {
    rememberToolPermissionRule(rule);
    setSaved({
      sessionId: savedSessionId,
      rule,
      scope,
      undone: false,
      undoError: "",
    });
  };

  const undo = (rule: ToolPermissionRule) =>
    whileRunning(setUndoing, async () => {
      const update = (change: Partial<SavedRule>) =>
        setSaved((current) =>
          current?.rule.id === rule.id ? { ...current, ...change } : current,
        );
      update({ undoError: "" });
      try {
        await deleteToolPermissionRule(rule.id);
        update({ undone: true });
      } catch (error) {
        update({
          undoError:
            error instanceof Error
              ? error.message
              : "Could not remove the rule",
        });
      }
    });

  return {
    saved: saved?.sessionId === sessionId ? saved : null,
    undoing,
    save,
    undo,
  };
}
