import type { JsonObject } from "@bufbuild/protobuf";
import type { Message } from "../../src/gen/euler/v1/sessions_pb";

export type {
  Message,
  MessageVersion,
  SessionSummary,
} from "../../src/gen/euler/v1/sessions_pb";
export type { CostBreakdown, Step } from "../../src/gen/euler/v1/steps_pb";

/** Confirm deleting later messages before an edit or regenerate. */
export type TruncateConfirmState =
  | { kind: "edit"; userIndex: number; text: string }
  | { kind: "regenerate"; assistantIndex: number }
  | null;

export interface DebugData {
  error?: string;
  systemPrompt: string;
  history: Message[];
  customTitle?: string;
  /** Cumulative model `messages` (excludes system); next turn prepends system and appends the new user message. */
  modelMessages?: JsonObject[];
}
