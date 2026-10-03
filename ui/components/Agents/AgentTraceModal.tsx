import { useEffect, useState } from "react";
import {
  type Agent,
  isFinalAgent,
  isWorkingAgent,
} from "../../../src/schemas/agents";
import type { Diagnostic } from "../../../src/schemas/observability";
import { toDiagnostic } from "../../lib/apiError";
import { fetchAgent } from "../../persist/agents";
import type { MessageStep } from "../../types";
import { ErrorNotice } from "../ErrorNotice";
import { ModelLabel } from "../ModelLabel";
import { StepsModal } from "../StepsModal";
import { AgentAvatar } from "./AgentAvatar";
import { AgentStatus } from "./AgentStatus";
import { AgentStopButton } from "./AgentTaskCard";

export function AgentTraceModal({
  sessionId,
  agent,
  onClose,
}: {
  sessionId: string;
  agent: Agent;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Awaited<
    ReturnType<typeof fetchAgent>
  > | null>(null);
  const [error, setError] = useState<Diagnostic | null>(null);
  const working = isWorkingAgent(agent);
  // Step events cover only the main agent's activation, so poll while it works
  // and refetch when its status changes.
  useEffect(() => {
    let disposed = false;
    const refresh = () =>
      void fetchAgent(sessionId, agent.id)
        .then((value) => {
          if (!disposed) {
            setDetail(value);
            setError(null);
          }
        })
        .catch((e) => {
          if (!disposed) setError(toDiagnostic(e));
        });
    refresh();
    const timer = working ? setInterval(refresh, 1000) : undefined;
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [sessionId, agent.id, agent.status, working]);
  const initialPrompt = detail?.messages.find(
    (m) => m.kind === "task",
  )?.content;
  // Server step records, trusted like transcript steps in useAgentEvents.
  const steps = (detail?.steps ?? []) as unknown as MessageStep[];
  return (
    <StepsModal
      steps={steps}
      title={agent.title}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <AgentAvatar agent={agent} size={14} />
          <AgentStatus agent={agent} />
          <ModelLabel
            model={agent.model}
            hideProvider
            className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground [&>img]:size-3"
          />
        </span>
      }
      actions={!isFinalAgent(agent) && <AgentStopButton agent={agent} />}
      onClose={onClose}
    >
      {agent.interruption && (
        <p className="mb-3 text-sm text-muted-foreground">
          {agent.interruption}
        </p>
      )}
      {error && <ErrorNotice error={error} className="mb-3" />}
      {initialPrompt && (
        <p className="mb-4 whitespace-pre-wrap break-words rounded-xl border border-border-subtle bg-muted/25 p-3 text-[0.8125rem] text-muted-foreground">
          {initialPrompt}
        </p>
      )}
      {detail && steps.length === 0 && (
        <p className="text-sm text-muted-foreground">No steps yet.</p>
      )}
    </StepsModal>
  );
}
