import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { MAIN_AGENT_NAME } from "../../../src/agents/agentNames";
import {
  type ImageAttachment,
  MessageAttachmentSchema,
} from "../../../src/attachments/types";
import { readApiError } from "../../lib/readApiError";
import { readSseBlocks } from "../../lib/readSseBlocks";
import { getActiveRun } from "../../persist/runs";
import { fetchSession, patchSessionApi } from "../../persist/sessions";
import { userScopedFetch } from "../../persist/userIdentity";
import { buildRunMetadata } from "../../persist/userSettings";
import type { UserSettings } from "../../persist/userSettings";
import type { Message, MessageStep, MessageVersion } from "../../types";
import { type StreamBuffer, createEmptyStreamBuffer } from "./streamBuffer";

type AppDeps = {
  activeSessionIdRef: MutableRefObject<string | null>;
  isEphemeralRef: MutableRefObject<boolean>;
  userSettingsRef: MutableRefObject<UserSettings>;
  modelMessagesRef: MutableRefObject<Array<Record<string, unknown>> | null>;
  debugOpenRef: MutableRefObject<boolean>;
  modelSendReady: boolean;
  selectedModel: string;
  reasoningEffort?: string;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  refreshSessions: () => Promise<void>;
};

type RuntimeDeps = {
  abortControllerRef: MutableRefObject<AbortController | null>;
  activeRequestIdRef: MutableRefObject<string | null>;
  inFlightSessionIdRef: MutableRefObject<string | null>;
  inFlightEphemeralRef: MutableRefObject<boolean>;
  rawRunPendingRef: MutableRefObject<boolean>;
  streamBufferRef: MutableRefObject<StreamBuffer>;
  turnMessagesSnapshotRef: MutableRefObject<Message[] | null>;
  turnVersionsRef: MutableRefObject<MessageVersion[]>;
  setInFlightSessionId: Dispatch<SetStateAction<string | null>>;
  setRunPending: Dispatch<SetStateAction<boolean>>;
  setStreamingStep: Dispatch<SetStateAction<MessageStep | null>>;
  setStreamingSteps: Dispatch<SetStateAction<MessageStep[]>>;
  setStreamingContent: Dispatch<SetStateAction<string>>;
  setStreamingThinking: Dispatch<SetStateAction<string>>;
  clearStreamingUi: () => void;
  reconnectToStream: (sessionId: string, requestId: string) => void;
  fetchDebugData: (sessionId: string) => Promise<void>;
};

type TurnOptions = {
  rebuildModelMessages: boolean;
  /** Earlier replies to keep on this turn's reply. */
  versions?: MessageVersion[];
};

export async function executeRunTurn(
  p: AppDeps,
  runtime: RuntimeDeps,
  turnSessionId: string,
  priorMessages: Message[],
  messageText: string,
  attachments: ImageAttachment[],
  options: TurnOptions,
) {
  if (!messageText.trim() || !turnSessionId || !p.modelSendReady) return;

  const {
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
  } = runtime;
  const versions = options.versions ?? [];
  const keptVersions = versions.length > 0 ? { versions } : {};

  const message = messageText.trim();
  const ephemeral = p.isEphemeralRef.current;
  const userMessage: Message = {
    role: "user",
    content: message,
    ...(attachments.length > 0 ? { attachments } : {}),
  };
  const nextHistory = [...priorMessages, userMessage];

  abortControllerRef.current?.abort();
  const controller = new AbortController();
  abortControllerRef.current = controller;
  activeRequestIdRef.current = null;
  const ownsStream = () => abortControllerRef.current === controller;

  inFlightSessionIdRef.current = turnSessionId;
  inFlightEphemeralRef.current = ephemeral;
  streamBufferRef.current = createEmptyStreamBuffer();
  turnMessagesSnapshotRef.current = nextHistory;
  turnVersionsRef.current = versions;
  rawRunPendingRef.current = true;
  setInFlightSessionId(turnSessionId);
  setRunPending(true);
  clearStreamingUi();

  const viewingThisTurn = () =>
    ownsStream() && p.activeSessionIdRef.current === turnSessionId;
  if (viewingThisTurn()) p.setMessages(nextHistory);

  const failWithAssistantError = async (errorText: string) => {
    const failedHistory: Message[] = [
      ...nextHistory,
      { role: "assistant", content: `Error: ${errorText}`, ...keptVersions },
    ];
    if (viewingThisTurn()) p.setMessages(failedHistory);
    if (ephemeral) return;

    let modelMessages = options.rebuildModelMessages
      ? null
      : p.modelMessagesRef.current;
    if (!viewingThisTurn()) {
      try {
        const current = await fetchSession(turnSessionId);
        modelMessages = options.rebuildModelMessages
          ? null
          : (current?.modelMessages ?? null);
      } catch {
        modelMessages = null;
      }
    }
    try {
      await patchSessionApi(turnSessionId, {
        history: failedHistory,
        modelMessages,
      });
    } catch (error) {
      console.error(error);
    }
    await p.refreshSessions();
  };

  const modelMessagesPayload = options.rebuildModelMessages
    ? null
    : p.modelMessagesRef.current;
  const reconnectAfterCleanup: {
    current: { sessionId: string; requestId: string } | null;
  } = { current: null };
  let terminalEventReceived = false;

  try {
    let response: Response;
    try {
      const settings = p.userSettingsRef.current;
      const metadata = buildRunMetadata(settings);
      const body: Record<string, unknown> = {
        message,
        history: priorMessages,
        model: p.selectedModel,
        ...(p.reasoningEffort ? { reasoningEffort: p.reasoningEffort } : {}),
        modelMessages: modelMessagesPayload,
        ...(attachments.length > 0
          ? { attachmentIds: attachments.map((attachment) => attachment.id) }
          : {}),
        metadata,
        ...keptVersions,
        sessionId: turnSessionId,
        ...(ephemeral ? { ephemeral: true } : {}),
      };
      response = await userScopedFetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error(error);
      await failWithAssistantError(
        error instanceof Error ? error.message : "Network error",
      );
      return;
    }

    if (!response.ok) {
      await failWithAssistantError(await readApiError(response));
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      await failWithAssistantError("No response body");
      return;
    }

    const recoverPersistentStream = async () => {
      const status = await getActiveRun(turnSessionId);
      if (status?.active && status.requestId) {
        reconnectAfterCleanup.current = {
          sessionId: turnSessionId,
          requestId: status.requestId,
        };
        return;
      }

      const completed = await fetchSession(turnSessionId);
      if (viewingThisTurn()) {
        clearStreamingUi();
        if (completed?.history?.length) {
          p.setMessages(completed.history);
          p.modelMessagesRef.current = completed.modelMessages ?? null;
        }
      }
      await p.refreshSessions();
    };

    try {
      await readSseBlocks(reader, async (data) => {
        if (!ownsStream() || controller.signal.aborted) return;
        if (data.type === "run_started") {
          if (typeof data.requestId === "string") {
            activeRequestIdRef.current = data.requestId;
          }
        } else if (data.type === "run_delta") {
          const contentDelta =
            typeof data.contentDelta === "string" ? data.contentDelta : "";
          const thinkingDelta =
            typeof data.thinkingDelta === "string" ? data.thinkingDelta : "";
          const agentName =
            typeof data.agentName === "string" ? data.agentName : "";
          const buffer = streamBufferRef.current;
          if (thinkingDelta) buffer.thinking += thinkingDelta;
          if (contentDelta && agentName === MAIN_AGENT_NAME) {
            buffer.content += contentDelta;
          }
          if (!viewingThisTurn()) return;
          if (contentDelta && agentName === MAIN_AGENT_NAME) {
            setStreamingContent((current) => current + contentDelta);
          }
          if (thinkingDelta) {
            setStreamingThinking((current) => current + thinkingDelta);
          }
        } else if (data.type === "run_step") {
          const step = data.step as MessageStep;
          const buffer = streamBufferRef.current;
          if (step.status === "running") {
            buffer.thinking = "";
            if (step.kind !== "complete") buffer.content = "";
          }
          buffer.step = step;
          if (Array.isArray(data.steps)) {
            buffer.steps = data.steps as MessageStep[];
          }
          if (!viewingThisTurn()) return;
          if (step.status === "running") {
            setStreamingThinking("");
            if (step.kind !== "complete") setStreamingContent("");
          }
          setStreamingStep(step);
          if (Array.isArray(data.steps)) {
            setStreamingSteps(data.steps as MessageStep[]);
          }
        } else if (data.type === "run_done") {
          terminalEventReceived = true;
          const outputAttachments = Array.isArray(data.attachments)
            ? data.attachments.flatMap((value) => {
                const result = MessageAttachmentSchema.safeParse(value);
                return result.success ? [result.data] : [];
              })
            : [];
          const assistantMessage: Message = {
            role: "assistant",
            content: typeof data.result === "string" ? data.result : "",
            steps: (Array.isArray(data.steps)
              ? data.steps
              : []) as MessageStep[],
            ...(outputAttachments.length > 0
              ? { attachments: outputAttachments }
              : {}),
            ...keptVersions,
          };
          if (ephemeral) {
            if (viewingThisTurn()) {
              clearStreamingUi();
              p.setMessages([...nextHistory, assistantMessage]);
              if (Array.isArray(data.modelMessages)) {
                p.modelMessagesRef.current = data.modelMessages as Array<
                  Record<string, unknown>
                >;
              }
            }
          } else {
            try {
              const stored = await fetchSession(turnSessionId);
              if (viewingThisTurn()) {
                clearStreamingUi();
                if (stored?.history?.length) p.setMessages(stored.history);
                p.modelMessagesRef.current = stored?.modelMessages ?? null;
              }
            } catch (error) {
              console.error(error);
              if (viewingThisTurn()) {
                clearStreamingUi();
                p.setMessages([...nextHistory, assistantMessage]);
              }
            }
            await p.refreshSessions();
          }
          if (p.debugOpenRef.current && viewingThisTurn()) {
            void fetchDebugData(turnSessionId);
          }
        } else if (data.type === "run_aborted") {
          terminalEventReceived = true;
          if (viewingThisTurn()) clearStreamingUi();
          const history = Array.isArray(data.history)
            ? (data.history as Message[])
            : [];
          if (history.length && viewingThisTurn()) p.setMessages(history);
          if (!ephemeral) {
            try {
              const stored = await fetchSession(turnSessionId);
              if (viewingThisTurn()) {
                if (stored?.history?.length) p.setMessages(stored.history);
                p.modelMessagesRef.current = stored?.modelMessages ?? null;
              }
            } catch (error) {
              console.error(error);
            }
            await p.refreshSessions();
          }
        } else if (data.type === "run_error") {
          terminalEventReceived = true;
          if (viewingThisTurn()) clearStreamingUi();
          const errorText =
            typeof data.error === "string" ? data.error : "Unknown error";
          await failWithAssistantError(errorText);
        }
      });
      if (!terminalEventReceived && !ephemeral && !controller.signal.aborted) {
        await recoverPersistentStream();
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error(error);
      if (ephemeral) {
        await failWithAssistantError(
          error instanceof Error ? error.message : String(error),
        );
      } else {
        try {
          await recoverPersistentStream();
        } catch (reconnectError) {
          console.error("run stream detached", reconnectError);
          if (activeRequestIdRef.current && ownsStream()) {
            reconnectAfterCleanup.current = {
              sessionId: turnSessionId,
              requestId: activeRequestIdRef.current,
            };
          }
        }
      }
    }
  } finally {
    if (ownsStream()) {
      const wasViewing = viewingThisTurn();
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
      if (wasViewing) clearStreamingUi();
    }
  }
  if (reconnectAfterCleanup.current && !controller.signal.aborted) {
    reconnectToStream(
      reconnectAfterCleanup.current.sessionId,
      reconnectAfterCleanup.current.requestId,
    );
  }
}
