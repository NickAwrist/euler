import type { WireMessage } from "../db/types";
import type { Agent, InboxMessage } from "../schemas/agents";
import type { ToolApproval } from "../schemas/toolPermissions";

/** The main agent's turn in progress, as the runtime keeps it. */
export type Activation = {
  id: string;
  agentId: string;
  sessionId: string;
  content: string;
  thinking: string;
  steps: Record<string, unknown>[];
};

/** A change the runtime publishes; the hub sequences it and converts it for clients. */
export type AgentEvent = { sessionId: string; agentId: string } & (
  | { type: "activation_started"; activation: Activation }
  | {
      type: "delta";
      activationId: string;
      contentDelta: string;
      thinkingDelta: string;
    }
  | {
      type: "step";
      activationId: string;
      /** The step's index in the activation's open segment. */
      position: number;
      step: Record<string, unknown>;
    }
  | {
      type: "activation_ended";
      activationId: string;
      outcome: "done" | "aborted" | "error" | "paused";
    }
  | { type: "transcript_appended"; message: WireMessage }
  | { type: "agent_status"; agent: Agent }
  | { type: "inbox_queued"; messages: InboxMessage[] }
  | { type: "approval_requested"; approval: ToolApproval }
  | { type: "approval_resolved"; approvalId: string }
  | { type: "resync" }
);
