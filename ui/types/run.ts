/** Nested subagent run attached to a tool_call step (from RunContext.wireSteps). */
export interface SubagentRun {
  agentName?: string;
  prompt?: string;
  steps?: MessageStep[];
}

export interface MessageStep {
  kind: string;
  status?: string;
  toolName?: string;
  agentName?: string;
  args?: unknown;
  thinking?: string;
  metrics?: {
    cost?: number;
    cachedTokens?: number;
    outputTokens?: number;
    outputDurationMs?: number;
    promptTokens?: number;
    promptDurationMs?: number;
    totalDurationMs?: number;
    loadDurationMs?: number;
    tokensPerSecond?: number;
  };
  result?: string;
  error?: string;
  childRun?: SubagentRun;
}

export interface Message {
  role: "user" | "assistant" | "event";
  content: string;
  steps?: MessageStep[];
  attachments?: MessageAttachment[];
  /** Earlier replies replaced by Regenerate, oldest first. */
  versions?: MessageVersion[];
}

/** An earlier reply replaced by Regenerate. */
export type MessageVersion = Pick<Message, "content" | "steps" | "attachments">;

/** Confirm deleting later messages before an edit or regenerate. */
export type TruncateConfirmState =
  | { kind: "edit"; userIndex: number; text: string }
  | { kind: "regenerate"; assistantIndex: number }
  | null;

export type { SessionSummary } from "../../src/schemas/sessions";

export interface DebugData {
  error?: string;
  systemPrompt: string;
  history: Message[];
  customTitle?: string | null;
  /** Cumulative Ollama `messages` (excludes system); next turn prepends system and appends the new user message. */
  modelMessages?: Array<Record<string, unknown>> | null;
}

import type { MessageAttachment } from "../../src/attachments/types";
