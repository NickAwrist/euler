import { ShieldQuestion } from "lucide-react";
import { memo, useState } from "react";
import type {
  ToolApproval,
  ToolApprovalResponse,
  ToolPermissionRule,
} from "../../../src/schemas/toolPermissions";
import { whileRunning } from "../../lib/whileRunning";
import { respondToToolApproval } from "../../persist/agents";
import { Button } from "../Button";
import type { SavedRuleNotice } from "./useSavedRuleNotice";

type Decision = ToolApprovalResponse["decision"];

/** Pending tool calls from this chat's agents, answered above the composer. */
export const ToolApprovals = memo(function ToolApprovals({
  sessionId,
  approvals,
  refresh,
  notice,
}: {
  sessionId: string;
  approvals: ToolApproval[];
  refresh: () => Promise<void>;
  notice: SavedRuleNotice;
}) {
  const { saved, undoing, save, undo } = notice;
  return (
    <section
      aria-label="Tool approvals"
      className="max-h-[45vh] space-y-2 overflow-y-auto"
    >
      {approvals.map((approval) => (
        <ApprovalRequest
          key={approval.id}
          sessionId={sessionId}
          approval={approval}
          refresh={refresh}
          onSavedRule={(rule) => save(sessionId, rule, approval.matchingScope)}
        />
      ))}
      {saved && (
        <output className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            {saved.undone
              ? `Removed the rule for ${saved.rule.tool}.`
              : `Saved: allow matching ${saved.rule.tool} calls (${saved.scope}).`}
          </span>
          {saved.undoError && (
            <span role="alert" className="text-red-400">
              {saved.undoError}
            </span>
          )}
          {!saved.undone && (
            <Button
              variant="ghost"
              size="sm"
              loading={undoing}
              onClick={() => void undo(saved.rule)}
            >
              {saved.undoError ? "Retry undo" : "Undo"}
            </Button>
          )}
        </output>
      )}
    </section>
  );
});

function ApprovalRequest({
  sessionId,
  approval,
  refresh,
  onSavedRule,
}: {
  sessionId: string;
  approval: ToolApproval;
  refresh: () => Promise<void>;
  onSavedRule: (rule: ToolPermissionRule) => void;
}) {
  const [pending, setPending] = useState<Decision | null>(null);
  const [failed, setFailed] = useState<{
    decision: Decision;
    message: string;
  } | null>(null);
  // The server consumed the answer; only the runtime snapshot is outstanding.
  const [answered, setAnswered] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const titleId = `tool-approval-${approval.id}`;

  const reload = () =>
    whileRunning(setRefreshing, async () => {
      setRefreshError("");
      try {
        await refresh();
      } catch (error) {
        setRefreshError(
          error instanceof Error ? error.message : "Could not refresh",
        );
      }
    });

  const respond = async (decision: Decision) => {
    setFailed(null);
    setPending(decision);
    let result: Awaited<ReturnType<typeof respondToToolApproval>> | null = null;
    try {
      result = await respondToToolApproval(sessionId, approval.id, decision);
    } catch (error) {
      setFailed({
        decision,
        message:
          error instanceof Error ? error.message : "Could not send the answer",
      });
    }
    setPending(null);
    if (!result) return;
    setAnswered(true);
    if (result.rule) onSavedRule(result.rule);
    await reload();
  };

  return (
    <article
      aria-labelledby={titleId}
      className="rounded-lg border border-amber-500/30 bg-surface px-3 py-2 text-xs"
    >
      <div className="flex items-start gap-2">
        <ShieldQuestion
          size={14}
          aria-hidden
          className="mt-0.5 shrink-0 text-amber-400"
        />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 id={titleId} className="text-[0.8125rem] text-foreground">
              <span className="font-medium">{approval.agentTitle}</span> wants
              to run <code className="font-mono">{approval.tool}</code>
            </h3>
            {approval.arguments.background === true && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[0.6875rem] text-muted-foreground">
                Background
              </span>
            )}
          </div>
          <p
            className="truncate text-muted-foreground"
            title={`${approval.reason} In ${approval.workspacePath}`}
          >
            {approval.reason} In {approval.workspacePath}
          </p>
          <pre
            aria-label={`${approval.tool} arguments`}
            className="max-h-24 overflow-auto whitespace-pre-wrap break-all rounded bg-muted px-2 py-1.5 font-mono text-[0.6875rem] text-foreground"
          >
            {JSON.stringify(approval.arguments, null, 2)}
          </pre>
          {approval.tool === "bash" && (
            <p className="text-[0.6875rem] text-muted-foreground">
              Rules match command text. The OS sandbox still applies.
            </p>
          )}
        </div>
      </div>
      {answered && (
        <div className="mt-1.5 flex items-center gap-2">
          <output className="min-w-0 flex-1 text-muted-foreground">
            Answer sent. Waiting for the agent to update.
          </output>
          {refreshError && (
            <>
              <span role="alert" className="text-red-400">
                {refreshError}
              </span>
              <Button
                variant="ghost"
                size="sm"
                loading={refreshing}
                onClick={() => void reload()}
              >
                Retry refresh
              </Button>
            </>
          )}
        </div>
      )}
      {failed && (
        <div className="mt-1.5 flex items-center gap-2">
          <p role="alert" className="min-w-0 flex-1 text-red-400">
            {failed.message}
          </p>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending !== null}
            onClick={() => void respond(failed.decision)}
          >
            Retry
          </Button>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
        <p
          className="mr-auto min-w-0 truncate text-[0.6875rem] text-muted-foreground"
          title={approval.matchingScope}
        >
          Matching calls: {approval.matchingScope}
        </p>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending !== null || answered}
          loading={pending === "deny"}
          onClick={() => void respond("deny")}
        >
          Deny
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={pending !== null || answered}
          loading={pending === "allow_matching"}
          onClick={() => void respond("allow_matching")}
        >
          Allow matching calls
        </Button>
        <Button
          size="sm"
          disabled={pending !== null || answered}
          loading={pending === "allow_once"}
          onClick={() => void respond("allow_once")}
        >
          Allow once
        </Button>
      </div>
    </article>
  );
}
