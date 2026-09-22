import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { safeStorage } from "../../lib/safeStorage";
import { getActiveRun } from "../../persist/runs";
import {
  createSessionApi,
  createTemporarySessionApi,
  deleteSessionApi,
  deleteTemporarySessionApi,
  fetchSession,
  fetchSessionSummaries,
  patchSessionApi,
} from "../../persist/sessions";
import type { UserSettings } from "../../persist/userSettings";
import type {
  DebugData,
  Message,
  SessionSummary,
  TraceModalSelection,
  TruncateConfirmState,
} from "../../types";
import type { ModelOption } from "../../types";
import type { RunFlightApi, SessionLoadState } from "./runTypes";
import { effectiveDefaultRunModel } from "./sessionUtils";
import { useSessionPreferences } from "./useSessionPreferences";

const ACTIVE_SESSION_STORAGE_KEY = "activeSessionId";
const RUN_PATH_PREFIX = "/run/";

function sessionIdFromUrl(): string | null {
  const { pathname } = window.location;
  if (pathname.startsWith(RUN_PATH_PREFIX)) {
    const id = decodeURIComponent(pathname.slice(RUN_PATH_PREFIX.length));
    return id || null;
  }
  return null;
}

function pushSessionUrl(id: string | null) {
  const target = id ? `${RUN_PATH_PREFIX}${encodeURIComponent(id)}` : "/";
  if (window.location.pathname !== target) {
    window.history.pushState({ sessionId: id }, "", target);
  }
}

function replaceSessionUrl(id: string | null) {
  const target = id ? `${RUN_PATH_PREFIX}${encodeURIComponent(id)}` : "/";
  if (window.location.pathname !== target) {
    window.history.replaceState({ sessionId: id }, "", target);
  }
}

type Args = {
  ollamaModels: ModelOption[];
  serverDefaultModel: string;
  serverDefaultRunAgent: string;
  userSettingsRef: MutableRefObject<UserSettings>;
  userSettingsDefaultModel: string;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setEditingUserIndex: Dispatch<SetStateAction<number | null>>;
  setTruncateConfirm: Dispatch<SetStateAction<TruncateConfirmState>>;
  setStepsModalData: Dispatch<SetStateAction<TraceModalSelection>>;
  setDebugOpen: Dispatch<SetStateAction<boolean>>;
  setDebugData: Dispatch<SetStateAction<DebugData | null>>;
  resetStreamingUi: () => void;
  modelMessagesRef: MutableRefObject<Array<Record<string, unknown>> | null>;
  activeSessionIdRef: MutableRefObject<string | null>;
  isEphemeralRef: MutableRefObject<boolean>;
  selectedSessionAgentRef: MutableRefObject<string>;
  runFlightRef: MutableRefObject<RunFlightApi | null>;
  onNavigate?: () => void;
};

export function useSessionsAndNavigation(p: Args) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    sessionIdFromUrl,
  );
  const [isEphemeral, setIsEphemeral] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [sessionLoadState, setSessionLoadState] =
    useState<SessionLoadState>("loading");
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [runStatusState, setRunStatusState] = useState<
    "pending" | "resolved" | "error"
  >("pending");
  const statusControllerRef = useRef<AbortController | null>(null);

  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<
    string | null
  >(null);

  const refreshSessions = useCallback(async () => {
    try {
      const list = await fetchSessionSummaries();
      setSessions(list);
    } catch (e) {
      console.error(e);
      setSessions([]);
    }
  }, []);

  const preferences = useSessionPreferences({
    activeSessionId,
    activeSessionIdRef: p.activeSessionIdRef,
    isEphemeralRef: p.isEphemeralRef,
    userSettingsRef: p.userSettingsRef,
    serverDefaultModel: p.serverDefaultModel,
    userSettingsDefaultModel: p.userSettingsDefaultModel,
    refreshSessions,
    setMessages: p.setMessages,
  });

  const messagesRef = useRef(p.messages);
  messagesRef.current = p.messages;
  const loadGenRef = useRef(0);
  const restoreDoneRef = useRef(false);

  p.activeSessionIdRef.current = activeSessionId;
  p.isEphemeralRef.current = isEphemeral;
  p.selectedSessionAgentRef.current = preferences.selectedSessionAgent;

  const resetSessionTransientState = useCallback(() => {
    p.setMessages([]);
    p.resetStreamingUi();
    p.setEditingUserIndex(null);
    p.setTruncateConfirm(null);
    p.setStepsModalData(null);
    p.setDebugOpen(false);
    p.setDebugData(null);
    preferences.setThinkingEffort(null);
  }, [
    p.setMessages,
    p.resetStreamingUi,
    p.setEditingUserIndex,
    p.setTruncateConfirm,
    p.setStepsModalData,
    p.setDebugOpen,
    p.setDebugData,
    preferences.setThinkingEffort,
  ]);

  const canDiscardEmptySession =
    p.messages.length === 0 &&
    sessionLoadState === "empty" &&
    runStatusState === "resolved" &&
    !p.runFlightRef.current?.shouldPreserveMessages(activeSessionId ?? "");

  const loadSession = useCallback(
    async (id: string) => {
      const gen = ++loadGenRef.current;
      statusControllerRef.current?.abort();
      const controller = new AbortController();
      statusControllerRef.current = controller;
      const previousId = p.activeSessionIdRef.current;
      p.activeSessionIdRef.current = id;
      setActiveSessionId(id);
      setSessionLoadState("loading");
      setSessionError(null);
      setRunStatusState("pending");
      preferences.setThinkingEffort(null);
      const cf = p.runFlightRef.current;
      const preserve = cf?.shouldPreserveMessages(id) ?? false;
      const initialHistory = preserve
        ? (cf?.getTurnSnapshot() ??
          (previousId === id ? messagesRef.current : []))
        : [];
      const preserveHistory = preserve && initialHistory.length > 0;
      p.setMessages(initialHistory);
      // A local stream owns its buffers and may already have newer content.
      if (preserve) cf?.hydrateStreaming();
      else p.resetStreamingUi();
      p.setEditingUserIndex(null);
      p.setTruncateConfirm(null);
      const initialModelMessages = preserve ? p.modelMessagesRef.current : null;
      p.modelMessagesRef.current = initialModelMessages;

      const historyRequest = (async () => {
        try {
          const stored = await fetchSession(id);
          if (gen !== loadGenRef.current) return;
          if (!stored) throw new Error("Conversation not found.");
          preferences.setSessionModel(stored.model ?? null);
          preferences.setWorkspace(stored.workspace ?? { kind: "sandbox" });
          if (!preserveHistory) {
            // Streaming completion or another writer may have updated history
            // while this snapshot was in flight. Never replace that newer state.
            p.setMessages((current) =>
              gen === loadGenRef.current && current === initialHistory
                ? stored.history
                : current,
            );
            if (p.modelMessagesRef.current === initialModelMessages) {
              p.modelMessagesRef.current = stored.modelMessages ?? null;
            }
          }
          setSessionLoadState(
            stored.history.length > 0 || initialHistory.length > 0
              ? "loaded"
              : "empty",
          );
        } catch (error) {
          if (gen !== loadGenRef.current) return;
          setSessionError(
            error instanceof Error
              ? error.message
              : "Could not load conversation.",
          );
          setSessionLoadState("error");
        }
      })();

      // Run discovery controls sending and stream reconciliation, never history display.
      let statusError: string | null = null;
      const discoverRun = async () => {
        try {
          const status = await getActiveRun(id, controller.signal);
          if (
            !status ||
            typeof status.active !== "boolean" ||
            (status.active && !status.requestId)
          )
            throw new Error("Invalid run status.");
          if (gen !== loadGenRef.current) return;
          if (
            status.active &&
            status.requestId &&
            !p.runFlightRef.current?.shouldPreserveMessages(id)
          ) {
            p.runFlightRef.current?.reconnectToStream(id, status.requestId);
          }
          setRunStatusState("resolved");
          setSessionError((current) =>
            current === statusError ? null : current,
          );
        } catch (error) {
          if (gen !== loadGenRef.current || controller.signal.aborted) return;
          setRunStatusState("error");
          statusError =
            error instanceof Error
              ? error.message
              : "Could not check the active run.";
          setSessionError(statusError);
          window.setTimeout(() => {
            if (gen === loadGenRef.current && !controller.signal.aborted) {
              void discoverRun();
            }
          }, 1000);
        }
      };
      void discoverRun();
      await historyRequest;
    },
    [
      p.activeSessionIdRef,
      p.runFlightRef,
      p.setMessages,
      p.resetStreamingUi,
      p.setEditingUserIndex,
      p.setTruncateConfirm,
      p.modelMessagesRef,
      preferences.setThinkingEffort,
      preferences.setSessionModel,
      preferences.setWorkspace,
    ],
  );

  useEffect(() => {
    void refreshSessions();
    const restoredId =
      sessionIdFromUrl() ||
      safeStorage.session.getItem(ACTIVE_SESSION_STORAGE_KEY);
    if (restoredId) void loadSession(restoredId);
    restoreDoneRef.current = true;
    return () => {
      loadGenRef.current++;
      statusControllerRef.current?.abort();
    };
  }, [refreshSessions, loadSession]);

  const retrySessionLoad = useCallback(() => {
    const id = p.activeSessionIdRef.current;
    if (id) void loadSession(id);
  }, [loadSession, p.activeSessionIdRef]);

  useEffect(() => {
    if (activeSessionId && !isEphemeral) {
      safeStorage.session.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
      replaceSessionUrl(activeSessionId);
      return;
    }
    if (!restoreDoneRef.current) return;
    safeStorage.session.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    replaceSessionUrl(null);
  }, [activeSessionId, isEphemeral]);

  useEffect(() => {
    if (!activeSessionId || !isEphemeral) return;
    const temporarySessionId = activeSessionId;
    const cleanup = () => {
      void deleteTemporarySessionApi(temporarySessionId).catch(() => {});
    };
    window.addEventListener("pagehide", cleanup);
    return () => window.removeEventListener("pagehide", cleanup);
  }, [activeSessionId, isEphemeral]);

  const switchToSession = useCallback(
    async (id: string) => {
      const curId = p.activeSessionIdRef.current;
      const wasEphemeral = p.isEphemeralRef.current;
      if (curId && wasEphemeral) {
        void deleteTemporarySessionApi(curId).catch(() => {});
      }
      if (curId && curId !== id && !wasEphemeral && canDiscardEmptySession) {
        void deleteSessionApi(curId).then(refreshSessions).catch(console.error);
      }
      setIsEphemeral(false);
      pushSessionUrl(id);
      await loadSession(id);
      p.onNavigate?.();
    },
    [
      loadSession,
      p.activeSessionIdRef,
      p.isEphemeralRef,
      p.onNavigate,
      canDiscardEmptySession,
      refreshSessions,
    ],
  );

  const createSession = useCallback(async () => {
    setIsLoading(true);
    try {
      const curId = p.activeSessionIdRef.current;
      if (curId && p.isEphemeralRef.current) {
        await deleteTemporarySessionApi(curId);
      }
      if (curId && !p.isEphemeralRef.current && canDiscardEmptySession) {
        try {
          await deleteSessionApi(curId);
        } catch (e) {
          console.error(e);
        }
      }
      setIsEphemeral(false);
      const agentForNewRun = p.serverDefaultRunAgent;
      const names = new Set(p.ollamaModels.map((m) => m.id));
      let modelForNew = effectiveDefaultRunModel(
        p.userSettingsRef.current,
        p.serverDefaultModel,
      );
      if (names.size > 0 && !names.has(modelForNew)) {
        modelForNew = names.has(p.serverDefaultModel)
          ? p.serverDefaultModel
          : (p.ollamaModels[0]?.id ?? modelForNew);
      }
      preferences.setSelectedSessionAgent(agentForNewRun);
      const { id } = await createSessionApi({
        model: modelForNew,
      });
      await refreshSessions();
      pushSessionUrl(id);
      await loadSession(id);
      p.onNavigate?.();
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [
    loadSession,
    p.activeSessionIdRef,
    p.isEphemeralRef,
    p.onNavigate,
    canDiscardEmptySession,
    p.ollamaModels,
    p.serverDefaultRunAgent,
    p.serverDefaultModel,
    p.userSettingsRef,
    refreshSessions,
    preferences.setSelectedSessionAgent,
  ]);

  const createEphemeralSession = useCallback(async () => {
    const curId = p.activeSessionIdRef.current;
    if (curId && !p.isEphemeralRef.current && canDiscardEmptySession) {
      try {
        await deleteSessionApi(curId);
      } catch (e) {
        console.error(e);
      }
      await refreshSessions();
    }
    if (curId && p.isEphemeralRef.current) {
      await deleteTemporarySessionApi(curId).catch(() => {});
    }
    const { id } = await createTemporarySessionApi();
    loadGenRef.current++;
    statusControllerRef.current?.abort();
    setSessionLoadState("empty");
    setRunStatusState("resolved");
    setSessionError(null);
    setActiveSessionId(id);
    resetSessionTransientState();
    setIsEphemeral(true);
    p.modelMessagesRef.current = null;
    p.onNavigate?.();
    preferences.setSelectedSessionAgent(p.serverDefaultRunAgent);
    preferences.setWorkspace({ kind: "sandbox" });
    pushSessionUrl(null);
  }, [
    p.activeSessionIdRef,
    p.isEphemeralRef,
    p.onNavigate,
    canDiscardEmptySession,
    p.modelMessagesRef,
    p.serverDefaultRunAgent,
    resetSessionTransientState,
    refreshSessions,
    preferences.setSelectedSessionAgent,
    preferences.setWorkspace,
  ]);

  useEffect(() => {
    const onPopState = () => {
      const curId = p.activeSessionIdRef.current;
      if (curId && p.isEphemeralRef.current) {
        void deleteTemporarySessionApi(curId).catch(() => {});
      }
      const urlId = sessionIdFromUrl();
      if (urlId) {
        setIsEphemeral(false);
        void loadSession(urlId);
      } else {
        loadGenRef.current++;
        statusControllerRef.current?.abort();
        p.activeSessionIdRef.current = null;
        setActiveSessionId(null);
        setIsEphemeral(false);
        preferences.setWorkspace({ kind: "sandbox" });
        resetSessionTransientState();
      }
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [
    loadSession,
    p.activeSessionIdRef,
    p.isEphemeralRef,
    resetSessionTransientState,
    preferences.setWorkspace,
  ]);

  const goToHome = useCallback(async () => {
    loadGenRef.current++;
    statusControllerRef.current?.abort();
    const curId = p.activeSessionIdRef.current;
    if (curId && p.isEphemeralRef.current) {
      await deleteTemporarySessionApi(curId).catch(() => {});
    }
    if (curId && !p.isEphemeralRef.current && canDiscardEmptySession) {
      try {
        await deleteSessionApi(curId);
      } catch (e) {
        console.error(e);
      }
      await refreshSessions();
    }
    setIsEphemeral(false);
    setActiveSessionId(null);
    resetSessionTransientState();
    p.onNavigate?.();
    preferences.setSelectedSessionAgent(p.serverDefaultRunAgent);
    preferences.setWorkspace({ kind: "sandbox" });
    pushSessionUrl(null);
  }, [
    p.activeSessionIdRef,
    p.isEphemeralRef,
    p.onNavigate,
    canDiscardEmptySession,
    p.serverDefaultRunAgent,
    resetSessionTransientState,
    refreshSessions,
    preferences.setSelectedSessionAgent,
    preferences.setWorkspace,
  ]);

  const dropSessionFromApp = useCallback(
    async (id: string) => {
      try {
        await deleteSessionApi(id);
      } catch (e) {
        console.error(e);
      }
      if (activeSessionId === id) {
        loadGenRef.current++;
        statusControllerRef.current?.abort();
        p.activeSessionIdRef.current = null;
        setActiveSessionId(null);
        preferences.setWorkspace({ kind: "sandbox" });
        p.setMessages([]);
        p.setDebugOpen(false);
        p.setDebugData(null);
        p.setEditingUserIndex(null);
        p.setTruncateConfirm(null);
        replaceSessionUrl(null);
      }
      await refreshSessions();
    },
    [
      activeSessionId,
      p.setDebugData,
      p.setDebugOpen,
      p.setEditingUserIndex,
      p.setMessages,
      p.setTruncateConfirm,
      refreshSessions,
      preferences.setWorkspace,
    ],
  );

  const requestDeleteSession = useCallback(
    async (id: string) => {
      if (id === activeSessionId) {
        if (canDiscardEmptySession) {
          await dropSessionFromApp(id);
          return;
        }
        setPendingDeleteSessionId(id);
        return;
      }
      try {
        const full = await fetchSession(id);
        if (!full?.history?.length) {
          await dropSessionFromApp(id);
          return;
        }
      } catch {
        setPendingDeleteSessionId(id);
        return;
      }
      setPendingDeleteSessionId(id);
    },
    [activeSessionId, dropSessionFromApp, canDiscardEmptySession],
  );

  const performDeleteSession = useCallback(async () => {
    const id = pendingDeleteSessionId;
    setPendingDeleteSessionId(null);
    if (!id) return;
    await dropSessionFromApp(id);
  }, [dropSessionFromApp, pendingDeleteSessionId]);

  const saveSessionTitle = useCallback(
    async (title: string) => {
      if (!renameSessionId) return;
      const id = renameSessionId;
      try {
        await patchSessionApi(id, {
          customTitle: title.trim().length > 0 ? title.trim() : null,
        });
      } catch (e) {
        console.error(e);
      }
      setRenameSessionId(null);
      await refreshSessions();
    },
    [refreshSessions, renameSessionId],
  );

  const renameTarget = renameSessionId
    ? sessions.find((s) => s.id === renameSessionId)
    : null;

  return {
    sessions,
    activeSessionId,
    isEphemeral,
    isLoading,
    sessionLoadState,
    sessionError,
    retrySessionLoad,
    sessionSendReady:
      (sessionLoadState === "loaded" || sessionLoadState === "empty") &&
      runStatusState === "resolved",
    renameSessionId,
    setRenameSessionId,
    pendingDeleteSessionId,
    setPendingDeleteSessionId,
    ...preferences,
    refreshSessions,
    switchToSession,
    createSession,
    createEphemeralSession,
    goToHome,
    saveSessionTitle,
    renameTarget,
    requestDeleteSession,
    performDeleteSession,
  };
}
