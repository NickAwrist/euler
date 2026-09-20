import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  createSessionApi,
  createTemporarySessionApi,
  deleteSessionApi,
  deleteTemporarySessionApi,
  fetchSession,
  fetchSessionSummaries,
  patchSessionApi,
  selectSessionDirectory,
  useSessionSandbox,
} from "../../persist/sessions";
import { userScopedFetch } from "../../persist/userIdentity";
import type { UserSettings } from "../../persist/userSettings";
import { loadUserSettings } from "../../persist/userSettings";
import type {
  DebugData,
  Message,
  SessionSummary,
  SessionWorkspace,
  TraceModalSelection,
  TruncateConfirmState,
} from "../../types";
import type { ModelOption } from "../../types";
import type { RunFlightApi, SessionLoadState } from "./runTypes";
import { effectiveDefaultRunModel } from "./sessionUtils";

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("euler:sidebarCollapsed") === "true";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("euler:sidebarCollapsed", String(sidebarCollapsed));
    } catch {
      // Keep the sidebar usable when browser storage is unavailable.
    }
  }, [sidebarCollapsed]);
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<
    string | null
  >(null);
  const [selectedModel, setSelectedModel] = useState(() =>
    effectiveDefaultRunModel(loadUserSettings(), "gemma4:e4b"),
  );
  const [thinkingEffort, setThinkingEffort] = useState<string | null>(null);
  const [selectedSessionAgent, setSelectedSessionAgent] =
    useState("general_agent");
  const [workspace, setWorkspace] = useState<SessionWorkspace>({
    kind: "sandbox",
  });

  const [sessionModel, setSessionModel] = useState<string | null>(null);

  const messagesRef = useRef(p.messages);
  messagesRef.current = p.messages;
  const loadGenRef = useRef(0);
  const restoreDoneRef = useRef(false);
  const returningToSandboxRef = useRef(false);

  p.activeSessionIdRef.current = activeSessionId;
  p.isEphemeralRef.current = isEphemeral;
  p.selectedSessionAgentRef.current = selectedSessionAgent;

  const refreshSessions = useCallback(async () => {
    try {
      const list = await fetchSessionSummaries();
      setSessions(list);
    } catch (e) {
      console.error(e);
      setSessions([]);
    }
  }, []);

  useEffect(() => {
    if (!activeSessionId) return;
    setSelectedModel(
      sessionModel?.trim() ||
        effectiveDefaultRunModel(
          p.userSettingsRef.current,
          p.serverDefaultModel,
        ),
    );
  }, [
    activeSessionId,
    sessionModel,
    p.serverDefaultModel,
    p.userSettingsRef,
    p.userSettingsDefaultModel,
  ]);

  const handleSessionAgentChange = useCallback((name: string) => {
    setSelectedSessionAgent(name);
  }, []);

  const chooseDirectory = useCallback(
    async (path: string) => {
      const sid = p.activeSessionIdRef.current;
      if (!sid) return;
      const temporary = p.isEphemeralRef.current;
      const selected = await selectSessionDirectory(sid, path, temporary);
      if (p.activeSessionIdRef.current === sid) {
        setWorkspace(selected);
        if (temporary) {
          p.setMessages((messages) => [
            ...messages,
            {
              role: "event",
              content: `Working directory changed to ${selected.kind === "local" ? selected.path : "the private workspace"}`,
            },
          ]);
          return;
        }
        const refreshed = await fetchSession(sid);
        if (refreshed && p.activeSessionIdRef.current === sid)
          p.setMessages(refreshed.history);
      }
    },
    [p.activeSessionIdRef, p.isEphemeralRef, p.setMessages],
  );

  const returnToSandbox = useCallback(async () => {
    const sid = p.activeSessionIdRef.current;
    if (!sid || workspace.kind !== "local" || returningToSandboxRef.current)
      return;
    returningToSandboxRef.current = true;
    try {
      const temporary = p.isEphemeralRef.current;
      setWorkspace(await useSessionSandbox(sid, temporary));
      if (temporary) {
        p.setMessages((messages) => [
          ...messages,
          { role: "event", content: "Returned to the private workspace" },
        ]);
        return;
      }
      const refreshed = await fetchSession(sid);
      if (refreshed) p.setMessages(refreshed.history);
    } finally {
      returningToSandboxRef.current = false;
    }
  }, [p.activeSessionIdRef, p.isEphemeralRef, p.setMessages, workspace.kind]);

  const resetSessionTransientState = useCallback(() => {
    p.setMessages([]);
    p.resetStreamingUi();
    p.setEditingUserIndex(null);
    p.setTruncateConfirm(null);
    p.setStepsModalData(null);
    p.setDebugOpen(false);
    p.setDebugData(null);
    setThinkingEffort(null);
  }, [
    p.setMessages,
    p.resetStreamingUi,
    p.setEditingUserIndex,
    p.setTruncateConfirm,
    p.setStepsModalData,
    p.setDebugOpen,
    p.setDebugData,
  ]);

  const handleThinkingEffortChange = useCallback((effort: string) => {
    setThinkingEffort(effort);
  }, []);

  const handleModelChange = useCallback(
    async (model: string) => {
      setSelectedModel(model);
      setSessionModel(model);
      setThinkingEffort(null);
      if (p.isEphemeralRef.current) return;
      const sid = p.activeSessionIdRef.current;
      if (sid) {
        try {
          await patchSessionApi(sid, { model });
          await refreshSessions();
        } catch (e) {
          console.error(e);
        }
      }
    },
    [p.activeSessionIdRef, p.isEphemeralRef, refreshSessions],
  );

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
      setThinkingEffort(null);
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
          setSessionModel(stored.model ?? null);
          setWorkspace(stored.workspace ?? { kind: "sandbox" });
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
      void (async () => {
        try {
          const response = await userScopedFetch(
            `/api/runs/active/${encodeURIComponent(id)}`,
            { signal: controller.signal },
          );
          if (!response.ok) throw new Error("Could not check the active run.");
          const status = (await response.json()) as {
            active?: boolean;
            requestId?: string;
          };
          if (
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
        } catch (error) {
          if (gen !== loadGenRef.current || controller.signal.aborted) return;
          setRunStatusState("error");
          setSessionError(
            error instanceof Error
              ? error.message
              : "Could not check the active run.",
          );
        }
      })();
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
    ],
  );

  useEffect(() => {
    void refreshSessions();
    const restoredId =
      sessionIdFromUrl() || sessionStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
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
      sessionStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
      replaceSessionUrl(activeSessionId);
      return;
    }
    if (!restoreDoneRef.current) return;
    sessionStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
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
    },
    [
      loadSession,
      p.activeSessionIdRef,
      p.isEphemeralRef,
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
      setSelectedSessionAgent(agentForNewRun);
      const { id } = await createSessionApi({
        model: modelForNew,
      });
      await refreshSessions();
      pushSessionUrl(id);
      await loadSession(id);
      setSidebarOpen(false);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [
    loadSession,
    p.activeSessionIdRef,
    p.isEphemeralRef,
    canDiscardEmptySession,
    p.ollamaModels,
    p.serverDefaultRunAgent,
    p.serverDefaultModel,
    p.userSettingsRef,
    refreshSessions,
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
    setSidebarOpen(false);
    setSelectedSessionAgent(p.serverDefaultRunAgent);
    setWorkspace({ kind: "sandbox" });
    pushSessionUrl(null);
  }, [
    p.activeSessionIdRef,
    p.isEphemeralRef,
    canDiscardEmptySession,
    p.modelMessagesRef,
    p.serverDefaultRunAgent,
    resetSessionTransientState,
    refreshSessions,
  ]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sidebarOpen]);

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
        setWorkspace({ kind: "sandbox" });
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
    setSidebarOpen(false);
    setSelectedSessionAgent(p.serverDefaultRunAgent);
    setWorkspace({ kind: "sandbox" });
    pushSessionUrl(null);
  }, [
    p.activeSessionIdRef,
    p.isEphemeralRef,
    canDiscardEmptySession,
    p.serverDefaultRunAgent,
    resetSessionTransientState,
    refreshSessions,
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
        setWorkspace({ kind: "sandbox" });
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
    sidebarOpen,
    setSidebarOpen,
    sidebarCollapsed,
    setSidebarCollapsed,
    renameSessionId,
    setRenameSessionId,
    pendingDeleteSessionId,
    setPendingDeleteSessionId,
    selectedModel,
    thinkingEffort,
    selectedSessionAgent,
    workspace,
    refreshSessions,
    handleSessionAgentChange,
    handleThinkingEffortChange,
    chooseDirectory,
    returnToSandbox,
    handleModelChange,
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
