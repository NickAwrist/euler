import { logEvent } from "../../observability/logger";
import { missingToolResults } from "../toolResults";
import type { ActivationHost } from "./activation";
import { inboxModelContent } from "./agentContext";

export type RecoveryHost = Pick<
  ActivationHost,
  "store" | "status" | "append" | "atomically"
> & { release(sessionId: string): void };

/**
 * Settles agents a server restart interrupted. A main agent keeps its partial
 * reply and holds its input; a subagent receives its pending messages and
 * waits, ready, for new instructions. Nothing starts solely because of this.
 */
export function recoverInterrupted(host: RecoveryHost) {
  const { store } = host;
  for (const agent of store.interrupted()) {
    logEvent("warn", "activation.interrupted", {
      sessionId: agent.sessionId,
      agentId: agent.id,
    });
    store.failRunningSteps(agent.id, "Interrupted by server restart");
    const reply = agent.kind === "main" ? store.reply(agent.id) : undefined;
    const steps = agent.kind === "main" ? store.steps(agent.id) : [];
    const replying = reply !== undefined || steps.length > 0;
    host.atomically(agent.sessionId, () => {
      const history = [
        ...agent.history,
        ...missingToolResults(
          agent.history,
          "Interrupted by a server restart. Check the current state before retrying.",
        ),
      ];
      if (agent.kind === "main") {
        if (replying) {
          host.append(agent, {
            role: "assistant",
            content: `${reply ?? ""}\n\n*Response interrupted by server restart.*`,
            steps,
            attachments: agent.pendingOutputs,
          });
          agent.pendingOutputs = [];
        }
        store.clearSegment(agent);
        store.hold(agent.id, true);
      } else {
        const pending = store.undelivered(agent.id);
        const peers = store.list(agent.ownerUuid, agent.sessionId);
        for (const message of pending) {
          agent.pendingOutputs.push(...message.attachments);
          history.push({
            role: "user",
            content: inboxModelContent(message, peers),
          });
        }
        store.deliver(pending);
        agent.activity =
          "Interrupted by server restart. Ready for new instructions.";
        agent.interruption = agent.activity;
        history.push({ role: "user", content: agent.activity });
      }
      agent.status = "idle";
      store.saveHistory(agent, history);
      host.status(agent);
    });
    host.release(agent.sessionId);
  }
}
