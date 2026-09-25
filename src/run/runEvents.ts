import type { Response } from "express";
import type { MessageAttachment } from "../attachments/types";
import { logger } from "../logger";
import type { HistoryWireStep } from "../session/AgentSession";

export type RunEvent =
  | { type: "run_started"; requestId: string }
  | {
      type: "run_delta";
      contentDelta: string;
      thinkingDelta: string;
      agentName: string;
    }
  | {
      type: "run_step";
      step: Record<string, unknown>;
      steps: Record<string, unknown>[];
    }
  | {
      type: "run_done";
      result: string;
      steps: HistoryWireStep[];
      modelMessages?: Array<Record<string, unknown>>;
      attachments?: MessageAttachment[];
    }
  | {
      type: "run_aborted";
      result: string;
      steps: HistoryWireStep[];
      history: Array<{
        role: string;
        content: string;
        steps?: HistoryWireStep[];
        attachments?: MessageAttachment[];
      }>;
      modelMessages: Array<Record<string, unknown>> | null;
    }
  | { type: "run_error"; error: string };

export type ActiveGeneration = {
  requestId: string;
  sessionId: string;
  ownerUuid: string;
  abortController: AbortController;
  eventBuffer: RunEvent[];
  clients: Set<Response>;
};

export function writeSse(res: Response, payload: RunEvent): void {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export function broadcastSse(gen: ActiveGeneration, payload: RunEvent): void {
  gen.eventBuffer.push(payload);
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of gen.clients) {
    try {
      client.write(data);
    } catch (err) {
      logger.debug({ err }, "sse client gone");
    }
  }
}
