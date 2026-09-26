import {
  type Dispatch,
  type FormEvent,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ImageAttachment } from "../../../src/attachments/types";
import { abortRun } from "../../persist/runs";
import { patchSessionApi } from "../../persist/sessions";
import type { UserSettings } from "../../persist/userSettings";

import type {
  DebugData,
  Message,
  MessageStep,
  MessageVersion,
  TruncateConfirmState,
} from "../../types";
import { executeRunTurn } from "./executeRunTurn";
import type { RunFlightApi } from "./runTypes";
import { createEmptyStreamBuffer } from "./streamBuffer";
import { usePendingImages } from "./usePendingImages";
import { useRunDebug } from "./useRunDebug";
import { useRunFlight } from "./useRunFlight";
import { useRunResume } from "./useRunResume";
import { useTurnBuffer } from "./useTurnBuffer";

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
  runFlightRef: MutableRefObject<RunFlightApi | null>;
  supportsImageInput: boolean;
  isEphemeral: boolean;
  startSession: () => Promise<string>;
};

export function useRunStreaming(p: Args) {
  const [input, setInput] = useState("");
  const [streamingStep, setStreamingStep] = useState<MessageStep | null>(null);
  const [streamingSteps, setStreamingSteps] = useState<MessageStep[]>([]);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingThinking, setStreamingThinking] = useState("");
  const [runPending, setRunPending] = useState(false);

  const rawRunPendingRef = useRef(false);
  const inFlightSessionIdRef = useRef<string | null>(null);
  const inFlightEphemeralRef = useRef(false);
  const { streamBufferRef, turnMessagesSnapshotRef, turnVersionsRef } =
    useTurnBuffer();

  p.debugOpenRef.current = p.debugOpen;

  const clearStreamingUi = useCallback(() => {
    setStreamingStep(null);
    setStreamingSteps([]);
    setStreamingContent("");
    setStreamingThinking("");
  }, []);

  useLayoutEffect(() => {
    p.bindStreamingReset(clearStreamingUi);
  }, [p.bindStreamingReset, clearStreamingUi]);

  const {
    abortControllerRef,
    activeRequestIdRef,
    inFlightSessionId,
    setInFlightSessionId,
    reconnectToStream,
  } = useRunFlight(
    {
      activeSessionIdRef: p.activeSessionIdRef,
      modelMessagesRef: p.modelMessagesRef,
      setMessages: p.setMessages,
      refreshSessions: p.refreshSessions,
      streamBufferRef,
      clearStreamingUi,
      setStreamingStep,
      setStreamingSteps,
      setStreamingContent,
      setStreamingThinking,
      setRunPending,
    },
    p.runFlightRef,
    rawRunPendingRef,
    inFlightSessionIdRef,
    inFlightEphemeralRef,
    turnMessagesSnapshotRef,
  );

  useRunResume({
    abortControllerRef,
    activeRequestIdRef,
    activeSessionIdRef: p.activeSessionIdRef,
    isEphemeralRef: p.isEphemeralRef,
    modelMessagesRef: p.modelMessagesRef,
    rawRunPendingRef,
    inFlightSessionIdRef,
    reconnectToStream,
    setMessages: p.setMessages,
    clearStreamingUi,
    refreshSessions: p.refreshSessions,
  });

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

  const runTurn = (
    sessionId: string,
    priorMessages: Message[],
    message: string,
    attachments: ImageAttachment[],
    options: { rebuildModelMessages: boolean; versions?: MessageVersion[] },
  ) =>
    executeRunTurn(
      {
        activeSessionIdRef: p.activeSessionIdRef,
        isEphemeralRef: p.isEphemeralRef,
        userSettingsRef: p.userSettingsRef,
        modelMessagesRef: p.modelMessagesRef,
        debugOpenRef: p.debugOpenRef,
        modelSendReady: p.modelSendReady,
        selectedModel: p.selectedModel,
        reasoningEffort: p.reasoningEffort,
        setMessages: p.setMessages,
        refreshSessions: p.refreshSessions,
      },
      {
        abortControllerRef,
        activeRequestIdRef,
        inFlightSessionIdRef,
        inFlightEphemeralRef,
        rawRunPendingRef,
        streamBufferRef,
        turnMessagesSnapshotRef,
        turnVersionsRef,
        setInFlightSessionId,
        setRunPending,
        setStreamingStep,
        setStreamingSteps,
        setStreamingContent,
        setStreamingThinking,
        clearStreamingUi,
        reconnectToStream,
        fetchDebugData,
      },
      sessionId,
      priorMessages,
      message,
      attachments,
      options,
    );

  const stopGeneration = () => {
    const controller = abortControllerRef.current;
    if (!controller) return;

    const requestId = activeRequestIdRef.current;
    const sessionId = inFlightSessionIdRef.current;
    const ephemeral = inFlightEphemeralRef.current;
    const versions = turnVersionsRef.current;
    if (requestId) {
      void abortRun(requestId).catch(() => {});
    }

    controller.abort();
    abortControllerRef.current = null;
    activeRequestIdRef.current = null;
    inFlightSessionIdRef.current = null;
    inFlightEphemeralRef.current = false;
    rawRunPendingRef.current = false;
    streamBufferRef.current = createEmptyStreamBuffer();
    turnMessagesSnapshotRef.current = null;
    turnVersionsRef.current = [];
    setInFlightSessionId(null);
    setRunPending(false);
    clearStreamingUi();

    p.setMessages((current) => {
      if (!sessionId || p.activeSessionIdRef.current !== sessionId) {
        return current;
      }
      const halted: Message[] = [
        ...current,
        {
          role: "assistant",
          content: "*Response halted by user.*",
          ...(versions.length > 0 ? { versions } : {}),
        },
      ];
      if (!ephemeral) {
        void patchSessionApi(sessionId, { history: halted }).catch((error) =>
          console.error(error),
        );
      }
      return halted;
    });
  };

  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    const message = input.trim();
    if (!message || !p.modelSendReady) return;
    if (images.pendingImages.length > 0 && !images.canAttachImages) {
      images.setImageError(
        !p.supportsImageInput
          ? "The selected model does not accept images."
          : "Images are not available in temporary sessions.",
      );
      return;
    }
    let sessionId = p.activeSessionId;
    if (!sessionId) {
      try {
        sessionId = await p.startSession();
      } catch (error) {
        console.error(error);
        return;
      }
    }

    const attachments = await images.uploadPendingImages(sessionId);
    if (!attachments) return;
    // Keep anything typed while attachments were uploading.
    setInput((current) => (current === input ? "" : current));
    images.clearPendingImages();
    await runTurn(sessionId, p.messages, message, attachments, {
      rebuildModelMessages: false,
    });
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
    if (assistantIndex < p.messages.length - 1) {
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

  const sessionRunBusy =
    images.uploadPending ||
    ((runPending || streamingStep !== null || streamingSteps.length > 0) &&
      inFlightSessionId !== null &&
      inFlightSessionId === p.activeSessionId);

  return {
    input,
    setInput,
    streamingStep,
    streamingSteps,
    streamingContent,
    streamingThinking,
    runPending: sessionRunBusy,
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
