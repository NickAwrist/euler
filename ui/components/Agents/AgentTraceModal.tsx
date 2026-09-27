import { useEffect, useState } from "react";
import {
  type Agent,
  isFinalAgent,
  isWorkingAgent,
} from "../../../src/schemas/agents";
import { fetchAgent } from "../../persist/agents";
import type { MessageStep } from "../../types";
import { StepsModal } from "../StepsModal";
import { AgentStopButton, agentStatusLabel } from "./AgentTaskCard";

export function AgentTraceModal({
  sessionId,
  temporary,
  agent,
  onClose,
}: {
  sessionId: string;
  temporary: boolean;
  agent: Agent;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Awaited<
    ReturnType<typeof fetchAgent>
  > | null>(null);
  const [error, setError] = useState("");
  const working = isWorkingAgent(agent);
  // Step events cover only the main agent's activation, so poll while it works
  // and refetch when its status changes.
  useEffect(() => {
    let disposed = false;
    const refresh = () =>
      void fetchAgent(sessionId, agent.id, temporary)
        .then((value) => {
          if (!disposed) {
            setDetail(value);
            setError("");
          }
        })
        .catch((e) => {
          if (!disposed) setError(String(e));
        });
    refresh();
    const timer = working ? setInterval(refresh, 1000) : undefined;
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [sessionId, temporary, agent.id, agent.status, working]);
  const task = detail?.messages.find((m) => m.kind === "task")?.content;
  // Server step records, trusted like transcript steps in useAgentEvents.
  const steps = (detail?.agent.steps ?? []) as unknown as MessageStep[];
  return (
    <StepsModal
      steps={steps}
      title={agent.title}
      subtitle={<span aria-live="polite">{agentStatusLabel(agent)}</span>}
      actions={!isFinalAgent(agent) && <AgentStopButton agent={agent} />}
      onClose={onClose}
    >
      {error && (
        <p role="alert" className="mb-3 text-sm text-red-400">
          {error}
        </p>
      )}
      {task && (
        <p className="mb-4 whitespace-pre-wrap break-words rounded-xl border border-border-subtle bg-muted/25 p-3 text-[0.8125rem] text-muted-foreground">
          {task}
        </p>
      )}
      {detail && steps.length === 0 && (
        <p className="text-sm text-muted-foreground">No steps yet.</p>
      )}
    </StepsModal>
  );
}
