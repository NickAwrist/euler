import type { Message } from "../../types";

export type MessageItemProps = {
  message: Message;
  messageIndex: number;
  animateEntry?: boolean;
  onViewSteps?: () => void;
  animDelayMs?: number;
  isBusy: boolean;
  editingUserIndex: number | null;
  onStartEditUser: (index: number) => void;
  onCancelEditUser: () => void;
  onRequestEditConfirm: (userIndex: number, text: string) => void;
  onRegenerate: (assistantIndex: number) => void;
  /** Names the model a regenerate will use. */
  regenerateLabel: string;
};
