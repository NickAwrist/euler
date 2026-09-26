import type { SessionLoadState } from "../../hooks/run/runTypes";
import type { Message, MessageStep, TraceModalOpenPayload } from "../../types";

export type RunAreaProps = {
  messages: Message[];
  sessionLoadState: SessionLoadState;
  sessionError: string | null;
  sessionSendReady: boolean;
  onRetryLoad: () => void;
  streamingSteps: MessageStep[];
  streamingStep: MessageStep | null;
  streamingContent: string;
  streamingThinking: string;
  runPending: boolean;
  footerInset: number;
  onViewSteps: (payload: TraceModalOpenPayload) => void;
  editingUserIndex: number | null;
  onStartEditUser: (index: number) => void;
  onCancelEditUser: () => void;
  onRequestEditConfirm: (userIndex: number, text: string) => void;
  onRegenerate: (assistantIndex: number) => void;
  regenerateLabel: string;
};
