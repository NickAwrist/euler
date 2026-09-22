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
  activeRequestIdRef: MutableRefObject<string | null>;
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
  activeRequestIdRef,
  reconnectToStream,
  setMessages,
  clearStreamingUi,
  refreshSessions,
}: Args) {
  const reconcilePendingRef = useRef(false);

  useEffect(() => {
    const reconcileVisibleSession = async (refreshCompleted = true) => {
      if (
        document.visibilityState === "hidden" ||
        reconcilePendingRef.current
      ) {
        return;
      }
      const sessionId = activeSessionIdRef.current;
      if (!sessionId || isEphemeralRef.current) return;

      // Discovery can race the POST while the server prepares the workspace.
      if (
        rawRunPendingRef.current &&
        inFlightSessionIdRef.current === sessionId &&
        !activeRequestIdRef.current
      )
        return;
      const controller = abortControllerRef.current;
      const requestId = activeRequestIdRef.current;

      reconcilePendingRef.current = true;
      try {
        const status = await getActiveRun(sessionId);
        if (!status || typeof status.active !== "boolean") return;
        if (
          !status.active &&
          !(
            rawRunPendingRef.current &&
            inFlightSessionIdRef.current === sessionId
          ) &&
          !refreshCompleted
        )
          return;
        await reconcilePersistentRun({
          sessionId,
          isCurrentSession: () =>
            activeSessionIdRef.current === sessionId &&
            abortControllerRef.current === controller &&
            activeRequestIdRef.current === requestId,
          isLocallyPending: () =>
            rawRunPendingRef.current &&
            inFlightSessionIdRef.current === sessionId,
          fetchStatus: async () => ({
            active: status.active === true,
            ...(status.requestId ? { requestId: status.requestId } : {}),
          }),
          fetchStoredSession: () => fetchSession(sessionId, { fresh: true }),
          onReconnect: (requestId) => reconnectToStream(sessionId, requestId),
          onCompleted: async (completed) => {
            if (completed?.history?.length) setMessages(completed.history);
            modelMessagesRef.current = completed?.modelMessages ?? null;
            clearStreamingUi();
            if (inFlightSessionIdRef.current === sessionId) {
              controller?.abort();
            }
            await refreshSessions();
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
    window.addEventListener("online", reconcile);
    const interval = window.setInterval(
      () => void reconcileVisibleSession(false),
      3000,
    );
    return () => {
      document.removeEventListener("visibilitychange", reconcileIfVisible);
      window.removeEventListener("pageshow", reconcile);
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("online", reconcile);
      window.clearInterval(interval);
    };
  }, [
    abortControllerRef,
    activeRequestIdRef,
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
