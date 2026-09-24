import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { MAIN_AGENT_NAME } from "../../../src/agents/agentNames";
import { readSseBlocks } from "../../lib/readSseBlocks";
import { getActiveRun } from "../../persist/runs";
import { fetchSession } from "../../persist/sessions";
import { userScopedFetch } from "../../persist/userIdentity";
import type { Message, MessageStep } from "../../types";
import type { RunFlightApi } from "./runTypes";
import { type StreamBuffer, createEmptyStreamBuffer } from "./streamBuffer";

type FlightDeps = {
  activeSessionIdRef: MutableRefObject<string | null>;
  modelMessagesRef: MutableRefObject<Array<Record<string, unknown>> | null>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  refreshSessions: () => Promise<void>;
  streamBufferRef: MutableRefObject<StreamBuffer>;
  clearStreamingUi: () => void;
  setStreamingStep: Dispatch<SetStateAction<MessageStep | null>>;
  setStreamingSteps: Dispatch<SetStateAction<MessageStep[]>>;
  setStreamingContent: Dispatch<SetStateAction<string>>;
  setStreamingThinking: Dispatch<SetStateAction<string>>;
  setRunPending: Dispatch<SetStateAction<boolean>>;
};

export function useRunFlight(
  deps: FlightDeps,
  runFlightRef: MutableRefObject<RunFlightApi | null>,
  rawRunPendingRef: MutableRefObject<boolean>,
  inFlightSessionIdRef: MutableRefObject<string | null>,
  inFlightEphemeralRef: MutableRefObject<boolean>,
  turnMessagesSnapshotRef: MutableRefObject<Message[] | null>,
) {
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const reconnectToStreamRef = useRef<
    (sessionId: string, requestId: string) => void
  >(() => {});
  const [inFlightSessionId, setInFlightSessionId] = useState<string | null>(
    null,
  );

  const reconnectToStream = useCallback(
    (sessionId: string, _requestId: string) => {
      if (
        rawRunPendingRef.current &&
        inFlightSessionIdRef.current === sessionId
      )
        return;

      // Disconnect the previous viewer; the server keeps its generation running.
      abortControllerRef.current?.abort();

      const d = depsRef.current;
      const controller = new AbortController();
      abortControllerRef.current = controller;
      activeRequestIdRef.current = _requestId;
      inFlightSessionIdRef.current = sessionId;
      inFlightEphemeralRef.current = false;
      rawRunPendingRef.current = true;
      turnMessagesSnapshotRef.current = null;
      d.streamBufferRef.current = createEmptyStreamBuffer();

      setInFlightSessionId(sessionId);
      d.setRunPending(true);
      d.clearStreamingUi();

      const ownsStream = () => abortControllerRef.current === controller;
      const viewing = () =>
        ownsStream() && d.activeSessionIdRef.current === sessionId;

      void (async () => {
        let terminalEventReceived = false;
        let retryRequestId: string | null = null;
        try {
          const res = await userScopedFetch(
            `/api/runs/stream/${encodeURIComponent(sessionId)}`,
            {
              signal: controller.signal,
            },
          );
          if (!res.ok || !res.body) throw new Error("Run stream unavailable.");
          const reader = res.body.getReader();
          const finalizeReconnect = async () => {
            if (viewing()) {
              d.clearStreamingUi();
            }
            try {
              const s = await fetchSession(sessionId, { fresh: true });
              if (viewing()) {
                if (s?.history?.length) d.setMessages(s.history);
                d.modelMessagesRef.current = s?.modelMessages ?? null;
              }
            } catch (e) {
              console.error(e);
            }
            await d.refreshSessions();
          };
          const recoverDetachedStream = async () => {
            const status = await getActiveRun(sessionId);
            if (status?.active && status.requestId) {
              retryRequestId = status.requestId;
            } else {
              await finalizeReconnect();
            }
          };

          await readSseBlocks(reader, async (data) => {
            if (!ownsStream() || controller.signal.aborted) return;
            if (data.type === "run_started") {
              if (typeof data.requestId === "string") {
                activeRequestIdRef.current = data.requestId;
              }
            } else if (data.type === "run_delta") {
              const cd =
                typeof data.contentDelta === "string" ? data.contentDelta : "";
              const td =
                typeof data.thinkingDelta === "string"
                  ? data.thinkingDelta
                  : "";
              const agent =
                typeof data.agentName === "string" ? data.agentName : "";
              const buf = d.streamBufferRef.current;
              if (td) buf.thinking += td;
              if (cd && agent === MAIN_AGENT_NAME) buf.content += cd;
              if (!viewing()) return;
              if (cd && agent === MAIN_AGENT_NAME)
                d.setStreamingContent((prev) => prev + cd);
              if (td) d.setStreamingThinking((prev) => prev + td);
            } else if (data.type === "run_step") {
              const step = data.step as MessageStep;
              const buf = d.streamBufferRef.current;
              if (step.status === "running") {
                buf.thinking = "";
                if (step.kind !== "complete") buf.content = "";
              }
              buf.step = step;
              if (Array.isArray(data.steps))
                buf.steps = data.steps as MessageStep[];
              if (!viewing()) return;
              if (step.status === "running") {
                d.setStreamingThinking("");
                if (step.kind !== "complete") d.setStreamingContent("");
              }
              d.setStreamingStep(step);
              if (Array.isArray(data.steps))
                d.setStreamingSteps(data.steps as MessageStep[]);
            } else if (
              data.type === "run_done" ||
              data.type === "run_aborted"
            ) {
              terminalEventReceived = true;
              await finalizeReconnect();
            } else if (data.type === "run_error") {
              terminalEventReceived = true;
              if (viewing()) {
                d.clearStreamingUi();
              }
            }
          });
          if (!terminalEventReceived && !controller.signal.aborted) {
            await recoverDetachedStream();
          }
        } catch (err) {
          if (controller.signal.aborted) return;
          console.error("reconnect stream error", err);
          try {
            const status = await getActiveRun(sessionId);
            if (status?.active && status.requestId) {
              retryRequestId = status.requestId;
            } else {
              const completed = await fetchSession(sessionId, {
                fresh: true,
              });
              if (viewing()) {
                if (completed?.history?.length) {
                  d.setMessages(completed.history);
                }
                d.modelMessagesRef.current = completed?.modelMessages ?? null;
              }
              await d.refreshSessions();
            }
          } catch (recoveryError) {
            console.error("reconnect recovery error", recoveryError);
            retryRequestId = _requestId;
          }
        } finally {
          if (ownsStream()) {
            const wasViewing = viewing();
            abortControllerRef.current = null;
            activeRequestIdRef.current = null;
            inFlightSessionIdRef.current = null;
            inFlightEphemeralRef.current = false;
            rawRunPendingRef.current = false;
            depsRef.current.streamBufferRef.current = createEmptyStreamBuffer();
            turnMessagesSnapshotRef.current = null;
            setInFlightSessionId(null);
            depsRef.current.setRunPending(false);
            if (wasViewing) {
              depsRef.current.clearStreamingUi();
            }
          }
        }
        if (retryRequestId && !controller.signal.aborted) {
          const requestId = retryRequestId;
          window.setTimeout(() => {
            if (
              !controller.signal.aborted &&
              abortControllerRef.current === null &&
              depsRef.current.activeSessionIdRef.current === sessionId
            )
              reconnectToStreamRef.current(sessionId, requestId);
          }, 1000);
        }
      })();
    },
    [
      rawRunPendingRef,
      inFlightSessionIdRef,
      inFlightEphemeralRef,
      turnMessagesSnapshotRef,
    ],
  );
  reconnectToStreamRef.current = reconnectToStream;

  useLayoutEffect(() => {
    runFlightRef.current = {
      shouldPreserveMessages: (sessionId: string) =>
        rawRunPendingRef.current && inFlightSessionIdRef.current === sessionId,
      getTurnSnapshot: () => turnMessagesSnapshotRef.current,
      hydrateStreaming: () => {
        const d = depsRef.current;
        const b = d.streamBufferRef.current;
        d.setStreamingContent(b.content);
        d.setStreamingThinking(b.thinking);
        d.setStreamingStep(b.step);
        d.setStreamingSteps(Array.isArray(b.steps) ? [...b.steps] : []);
      },
      reconnectToStream,
    };
  }, [
    runFlightRef,
    rawRunPendingRef,
    inFlightSessionIdRef,
    reconnectToStream,
    turnMessagesSnapshotRef,
  ]);

  return {
    abortControllerRef,
    activeRequestIdRef,
    inFlightSessionId,
    setInFlightSessionId,
    reconnectToStream,
  };
}
