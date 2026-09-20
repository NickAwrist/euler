import { type MutableRefObject, useEffect, useRef } from "react";
import { getActiveRun } from "../../persist/runs";
import { fetchSession } from "../../persist/sessions";
import type { Message } from "../../types";
import { reconcilePersistentRun } from "./reconcilePersistentRun";

type Args = {
  activeSessionIdRef: MutableRefObject<string | null>;
  isEphemeralRef: MutableRefObject<boolean>;
  modelMessagesRef: MutableRefObject<Array<Record<string, unknown>> | null>;
  rawRunPendingRef: MutableRefObject<boolean>;
  inFlightSessionIdRef: MutableRefObject<string | null>;
  abortControllerRef: MutableRefObject<AbortController | null>;
  reconnectToStream: (sessionId: string, requestId: string) => void;
  setMessages: (messages: Message[]) => void;
  clearStreamingUi: () => void;
  refreshSessions: () => Promise<void>;
};

export function useRunResume({
  activeSessionIdRef,
  isEphemeralRef,
  modelMessagesRef,
  rawRunPendingRef,
  inFlightSessionIdRef,
  abortControllerRef,
  reconnectToStream,
  setMessages,
  clearStreamingUi,
  refreshSessions,
}: Args) {
  const reconcilePendingRef = useRef(false);

  useEffect(() => {
    const reconcileVisibleSession = async () => {
      if (
        document.visibilityState === "hidden" ||
        reconcilePendingRef.current
      ) {
        return;
      }
      const sessionId = activeSessionIdRef.current;
      if (!sessionId || isEphemeralRef.current) return;

      reconcilePendingRef.current = true;
      try {
        await reconcilePersistentRun({
          sessionId,
          isCurrentSession: () => activeSessionIdRef.current === sessionId,
          isLocallyPending: () => rawRunPendingRef.current,
          fetchStatus: async () => {
            const status = await getActiveRun(sessionId);
            return {
              active: status?.active === true,
              ...(status?.requestId ? { requestId: status.requestId } : {}),
            };
          },
          fetchStoredSession: () => fetchSession(sessionId),
          onReconnect: (requestId) => reconnectToStream(sessionId, requestId),
          onCompleted: async (completed) => {
            if (completed?.history?.length) setMessages(completed.history);
            modelMessagesRef.current = completed?.modelMessages ?? null;
            clearStreamingUi();
            await refreshSessions();

            if (inFlightSessionIdRef.current === sessionId) {
              abortControllerRef.current?.abort();
            }
          },
        });
      } catch (error) {
        console.error("failed to reconcile resumed run", error);
      } finally {
        reconcilePendingRef.current = false;
      }
    };

    const reconcileIfVisible = () => {
      if (document.visibilityState === "visible") {
        void reconcileVisibleSession();
      }
    };
    const reconcile = () => void reconcileVisibleSession();

    document.addEventListener("visibilitychange", reconcileIfVisible);
    window.addEventListener("pageshow", reconcile);
    window.addEventListener("focus", reconcile);
    return () => {
      document.removeEventListener("visibilitychange", reconcileIfVisible);
      window.removeEventListener("pageshow", reconcile);
      window.removeEventListener("focus", reconcile);
    };
  }, [
    abortControllerRef,
    activeSessionIdRef,
    clearStreamingUi,
    inFlightSessionIdRef,
    isEphemeralRef,
    modelMessagesRef,
    rawRunPendingRef,
    reconnectToStream,
    refreshSessions,
    setMessages,
  ]);
}
