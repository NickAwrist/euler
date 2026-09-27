import {
  type Dispatch,
  type FormEvent,
  type MutableRefObject,
  type SetStateAction,
  useRef,
  useState,
} from "react";
import type { ImageAttachment } from "../../../src/attachments/types";
import { agentAction } from "../../persist/agents";
import { buildRunMetadata } from "../../persist/userSettings";
import type { UserSettings } from "../../persist/userSettings";
import { useAgentEvents } from "./useAgentEvents";

import type {
  DebugData,
  Message,
  MessageStep,
  MessageVersion,
  TruncateConfirmState,
} from "../../types";
import { usePendingImages } from "./usePendingImages";
import { useRunDebug } from "./useRunDebug";

type Args = {
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  activeSessionId: string | null;
  activeSessionIdRef: MutableRefObject<string | null>;
  isEphemeralRef: MutableRefObject<boolean>;
  userSettingsRef: MutableRefObject<UserSettings>;
  modelMessagesRef: MutableRefObject<Array<Record<string, unknown>> | null>;
  debugOpenRef: MutableRefObject<boolean>;
  debugOpen: boolean;
  setDebugOpen: Dispatch<SetStateAction<boolean>>;
  setDebugData: Dispatch<SetStateAction<DebugData | null>>;
  selectedModel: string;
  reasoningEffort?: string;
  modelSendReady: boolean;
  refreshSessions: () => Promise<void>;
  fetchOllamaHealth: () => Promise<void>;
  bindStreamingReset: (fn: () => void) => void;
  setEditingUserIndex: Dispatch<SetStateAction<number | null>>;
  truncateConfirm: TruncateConfirmState;
  setTruncateConfirm: Dispatch<SetStateAction<TruncateConfirmState>>;
  supportsImageInput: boolean;
  isEphemeral: boolean;
  startSession: () => Promise<string>;
};

export function useRunStreaming(p: Args) {
  const [input, setInput] = useState("");
  const sending = useRef(false);
  const events = useAgentEvents(
    p.activeSessionId,
    p.isEphemeral,
    p.setMessages,
    p.refreshSessions,
  );
  const fetchDebugData = useRunDebug({
    userSettingsRef: p.userSettingsRef,
    isEphemeralRef: p.isEphemeralRef,
    setDebugData: p.setDebugData,
  });

  const images = usePendingImages({
    activeSessionId: p.activeSessionId,
    supportsImageInput: p.supportsImageInput,
    isEphemeral: p.isEphemeral,
  });

  const runTurn = async (
    sessionId: string,
    priorMessages: Message[],
    message: string,
    attachments: ImageAttachment[],
    options: { rebuildModelMessages: boolean; versions?: MessageVersion[] },
  ) => {
    try {
      if (options.rebuildModelMessages) {
        await agentAction(
          sessionId,
          "rewind",
          {
            position: priorMessages.length,
            content: message,
            versions: options.versions,
          },
          p.isEphemeral,
        );
      } else {
        await agentAction(
          sessionId,
          "messages",
          {
            content: message,
            attachmentIds: attachments.map((a) => a.id),
            model: p.selectedModel,
            reasoningEffort: p.reasoningEffort,
            metadata: buildRunMetadata(p.userSettingsRef.current),
          },
          p.isEphemeral,
        );
      }
      void events.refresh().catch(console.error);
      return true;
    } catch (error) {
      images.setImageError(
        error instanceof Error ? error.message : "Could not send message",
      );
      return false;
    }
  };
  const stopGeneration = () => {
    if (p.activeSessionId)
      void agentAction(p.activeSessionId, "stop", {}, p.isEphemeral)
        .then(events.refresh)
        .catch(console.error);
  };

  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    const message = input.trim();
    if (!message || !p.modelSendReady || sending.current) return;
    if (images.pendingImages.length > 0 && !images.canAttachImages) {
      images.setImageError(
        !p.supportsImageInput
          ? "The selected model does not accept images."
          : "Images are not available in temporary sessions.",
      );
      return;
    }
    sending.current = true;
    try {
      const sessionId = p.activeSessionId ?? (await p.startSession());
      const attachments = await images.uploadPendingImages(sessionId);
      if (!attachments) return;
      if (
        await runTurn(sessionId, p.messages, message, attachments, {
          rebuildModelMessages: false,
        })
      ) {
        // Preserve a new draft typed while the request was being accepted.
        setInput((current) => (current === input ? "" : current));
        images.clearPendingImages();
      }
    } catch (error) {
      images.setImageError(
        error instanceof Error ? error.message : "Could not send message",
      );
    } finally {
      sending.current = false;
    }
  };

  const rerunFrom = (
    userIndex: number,
    message: string,
    versions?: MessageVersion[],
  ) => {
    const sessionId = p.activeSessionId;
    const row = p.messages[userIndex];
    if (!sessionId || !p.modelSendReady || row?.role !== "user") return;
    if (!message.trim()) return;
    return runTurn(
      sessionId,
      p.messages.slice(0, userIndex),
      message,
      row.attachments?.filter(
        (attachment): attachment is ImageAttachment =>
          attachment.kind === "image",
      ) ?? [],
      { rebuildModelMessages: true, versions },
    );
  };

  /** Reruns the user message before a reply and keeps the reply as a version. */
  const regenerate = async (assistantIndex: number) => {
    const reply = p.messages[assistantIndex];
    if (reply?.role !== "assistant") return;
    const userIndex = p.messages.findLastIndex(
      (message, index) => index < assistantIndex && message.role === "user",
    );
    const { content, steps, attachments, versions = [] } = reply;
    await rerunFrom(userIndex, p.messages[userIndex]?.content ?? "", [
      ...versions,
      { content, steps, attachments },
    ]);
  };

  const requestRegenerate = (assistantIndex: number) => {
    p.setEditingUserIndex(null);
    if (
      assistantIndex < p.messages.length - 1 ||
      events.agents.some(
        (agent) =>
          agent.kind !== "main" && agent.spawnPosition >= assistantIndex,
      )
    ) {
      p.setTruncateConfirm({ kind: "regenerate", assistantIndex });
    } else {
      void regenerate(assistantIndex);
    }
  };

  const confirmTruncate = async () => {
    const confirmation = p.truncateConfirm;
    p.setTruncateConfirm(null);
    p.setEditingUserIndex(null);
    if (confirmation?.kind === "edit") {
      await rerunFrom(confirmation.userIndex, confirmation.text);
    } else if (confirmation?.kind === "regenerate") {
      await regenerate(confirmation.assistantIndex);
    }
  };

  const toggleDebug = () => {
    if (!p.debugOpen && p.activeSessionId) {
      void p.fetchOllamaHealth();
      void fetchDebugData(p.activeSessionId, input);
    }
    p.setDebugOpen((open) => !open);
  };

  return {
    ...events,
    input,
    setInput,
    stopGeneration,
    sendMessage,
    requestRegenerate,
    confirmTruncate,
    toggleDebug,
    pendingImages: images.pendingImages,
    imageError: images.imageError,
    addPendingImages: images.addPendingImages,
    removePendingImage: images.removePendingImage,
    canAttachImages: images.canAttachImages,
    attachmentsSendReady: images.attachmentsSendReady,
    attachImageDisabledReason: images.attachImageDisabledReason,
  };
}
