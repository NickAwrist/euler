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
  NAVIGATION_EVENT,
  isChatPath,
  navigate,
  replaceNavigation,
  sessionIdFromUrl,
  sessionPath,
} from "../../lib/navigation";
import { safeStorage } from "../../lib/safeStorage";
import {
  createSessionApi,
  deleteSessionApi,
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
import type { SessionLoadState } from "./runTypes";
import { useSessionPreferences } from "./useSessionPreferences";

const ACTIVE_SESSION_STORAGE_KEY = "activeSessionId";
function initialSessionId() {
  return (
    sessionIdFromUrl() ||
    safeStorage.session.getItem(ACTIVE_SESSION_STORAGE_KEY)
  );
}

function pushSessionUrl(id: string | null) {
  // Session actions already update their state; only history needs changing.
  if (isChatPath()) void navigate(sessionPath(id));
}

function replaceSessionUrl(id: string | null) {
  if (isChatPath()) replaceNavigation(sessionPath(id));
}

type Args = {
  ollamaModels: ModelOption[];
  userSettingsRef: MutableRefObject<UserSettings>;
  userSettingsDefaultModel: string;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setEditingUserIndex: Dispatch<SetStateAction<number | null>>;
  setTruncateConfirm: Dispatch<SetStateAction<TruncateConfirmState>>;
  setStepsModalData: Dispatch<SetStateAction<TraceModalSelection>>;
  setDebugOpen: Dispatch<SetStateAction<boolean>>;
  setDebugData: Dispatch<SetStateAction<DebugData | null>>;
  activeSessionIdRef: MutableRefObject<string | null>;
  onNavigate?: () => void;
};

export function useSessionsAndNavigation(p: Args) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    initialSessionId,
  );
  /** When the open chat is deleted if it is ephemeral; null for saved chats. */
  const [activeExpiresAt, setActiveExpiresAt] = useState<number | null>(null);
  const [startingSession, setStartingSession] = useState(false);
  const [sessionLoadState, setSessionLoadState] =
    useState<SessionLoadState>("loading");
  const [sessionError, setSessionError] = useState<string | null>(null);

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
    activeSessionIdRef: p.activeSessionIdRef,
    userSettingsRef: p.userSettingsRef,
    ollamaModels: p.ollamaModels,
    userSettingsDefaultModel: p.userSettingsDefaultModel,
    refreshSessions,
    setMessages: p.setMessages,
  });

  const loadGenRef = useRef(0);
  const restoreDoneRef = useRef(false);

  p.activeSessionIdRef.current = activeSessionId;

  const resetSessionTransientState = useCallback(() => {
    p.setMessages([]);
    p.setEditingUserIndex(null);
    p.setTruncateConfirm(null);
    p.setStepsModalData(null);
    p.setDebugOpen(false);
    p.setDebugData(null);
    preferences.setThinkingEffort(null);
    preferences.setSessionModel(null);
  }, [
    p.setMessages,
    p.setEditingUserIndex,
    p.setTruncateConfirm,
    p.setStepsModalData,
    p.setDebugOpen,
    p.setDebugData,
    preferences.setThinkingEffort,
    preferences.setSessionModel,
  ]);

  const canDiscardEmptySession =
    p.messages.length === 0 && sessionLoadState === "empty";

  // Leaving a chat that never received a message deletes it.
  const discardEmptySession = useCallback(async () => {
    const curId = p.activeSessionIdRef.current;
    if (!curId || !canDiscardEmptySession) return;
    try {
      await deleteSessionApi(curId);
    } catch (e) {
      console.error(e);
    }
    await refreshSessions();
  }, [p.activeSessionIdRef, canDiscardEmptySession, refreshSessions]);

  const loadSession = useCallback(
    async (id: string) => {
      const gen = ++loadGenRef.current;
      p.activeSessionIdRef.current = id;
      setActiveSessionId(id);
      setActiveExpiresAt(null);
      setSessionLoadState("loading");
      setSessionError(null);
      preferences.setThinkingEffort(null);
      const cleared: Message[] = [];
      p.setMessages(cleared);
      p.setEditingUserIndex(null);
      p.setTruncateConfirm(null);

      try {
        const stored = await fetchSession(id);
        if (gen !== loadGenRef.current) return;
        if (!stored) throw new Error("Conversation not found.");
        setActiveExpiresAt(stored.expiresAt);
        preferences.setSessionModel(stored.model ?? null);
        preferences.setWorkspace(stored.workspace ?? { kind: "sandbox" });
        // The runtime snapshot may have set newer history while this
        // request was in flight. Never replace that newer state.
        p.setMessages((current) =>
          gen === loadGenRef.current && current === cleared
            ? stored.history
            : current,
        );
        setSessionLoadState(stored.history.length > 0 ? "loaded" : "empty");
      } catch (error) {
        if (gen !== loadGenRef.current) return;
        setSessionError(
          error instanceof Error
            ? error.message
            : "Could not load conversation.",
        );
        setSessionLoadState("error");
      }
    },
    [
      p.activeSessionIdRef,
      p.setMessages,
      p.setEditingUserIndex,
      p.setTruncateConfirm,
      preferences.setThinkingEffort,
      preferences.setSessionModel,
      preferences.setWorkspace,
    ],
  );

  useEffect(() => {
    void refreshSessions();
    const restoredId = initialSessionId();
    if (restoredId) void loadSession(restoredId);
    restoreDoneRef.current = true;
    return () => {
      loadGenRef.current++;
    };
  }, [refreshSessions, loadSession]);

  const retrySessionLoad = useCallback(() => {
    const id = p.activeSessionIdRef.current;
    if (id) void loadSession(id);
  }, [loadSession, p.activeSessionIdRef]);

  useEffect(() => {
    if (activeSessionId) {
      safeStorage.session.setItem(ACTIVE_SESSION_STORAGE_KEY, activeSessionId);
      replaceSessionUrl(activeSessionId);
      return;
    }
    if (!restoreDoneRef.current) return;
    safeStorage.session.removeItem(ACTIVE_SESSION_STORAGE_KEY);
    replaceSessionUrl(null);
  }, [activeSessionId]);

  const switchToSession = useCallback(
    async (id: string) => {
      if (p.activeSessionIdRef.current !== id) void discardEmptySession();
      pushSessionUrl(id);
      await loadSession(id);
      p.onNavigate?.();
    },
    [loadSession, p.activeSessionIdRef, p.onNavigate, discardEmptySession],
  );

  /** Saves the chat started from Home and opens it without reloading. */
  const startSession = useCallback(async () => {
    setStartingSession(true);
    try {
      const { id, expiresAt } = await createSessionApi({
        model: preferences.selectedModel || null,
      });
      loadGenRef.current++;
      p.activeSessionIdRef.current = id;
      setActiveSessionId(id);
      setActiveExpiresAt(expiresAt);
      setSessionLoadState("empty");
      setSessionError(null);
      preferences.setSessionModel(preferences.selectedModel || null);
      pushSessionUrl(id);
      void refreshSessions();
      return id;
    } finally {
      setStartingSession(false);
    }
  }, [
    p.activeSessionIdRef,
    preferences.selectedModel,
    preferences.setSessionModel,
    refreshSessions,
  ]);

  /** Opens a new chat that is deleted once its lifetime ends. */
  const createEphemeralSession = useCallback(async () => {
    await discardEmptySession();
    const { id, expiresAt } = await createSessionApi({ ephemeral: true });
    loadGenRef.current++;
    p.activeSessionIdRef.current = id;
    setActiveSessionId(id);
    setActiveExpiresAt(expiresAt);
    resetSessionTransientState();
    setSessionLoadState("empty");
    setSessionError(null);
    preferences.setWorkspace({ kind: "sandbox" });
    pushSessionUrl(id);
    void refreshSessions();
    p.onNavigate?.();
  }, [
    p.activeSessionIdRef,
    p.onNavigate,
    discardEmptySession,
    refreshSessions,
    resetSessionTransientState,
    preferences.setWorkspace,
  ]);

  useEffect(() => {
    const onPopState = (event: Event) => {
      if (
        !(event instanceof CustomEvent) ||
        !event.detail?.historyTraversal ||
        !isChatPath()
      )
        return;
      const urlId = sessionIdFromUrl();
      if (urlId === p.activeSessionIdRef.current) return;
      void discardEmptySession();
      if (urlId) {
        void loadSession(urlId);
      } else {
        loadGenRef.current++;
        p.activeSessionIdRef.current = null;
        setActiveSessionId(null);
        setActiveExpiresAt(null);
        preferences.setWorkspace({ kind: "sandbox" });
        resetSessionTransientState();
      }
    };
    window.addEventListener(NAVIGATION_EVENT, onPopState);
    return () => window.removeEventListener(NAVIGATION_EVENT, onPopState);
  }, [
    loadSession,
    discardEmptySession,
    p.activeSessionIdRef,
    resetSessionTransientState,
    preferences.setWorkspace,
  ]);

  const goToHome = useCallback(async () => {
    loadGenRef.current++;
    await discardEmptySession();
    setActiveSessionId(null);
    setActiveExpiresAt(null);
    resetSessionTransientState();
    p.onNavigate?.();
    preferences.setWorkspace({ kind: "sandbox" });
    pushSessionUrl(null);
  }, [
    p.onNavigate,
    discardEmptySession,
    resetSessionTransientState,
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
        p.activeSessionIdRef.current = null;
        setActiveSessionId(null);
        setActiveExpiresAt(null);
        preferences.setWorkspace({ kind: "sandbox" });
        preferences.setSessionModel(null);
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
      preferences.setSessionModel,
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
    activeExpiresAt,
    sessionLoadState,
    sessionError,
    retrySessionLoad,
    sessionSendReady: activeSessionId
      ? sessionLoadState === "loaded" || sessionLoadState === "empty"
      : !startingSession,
    renameSessionId,
    setRenameSessionId,
    pendingDeleteSessionId,
    setPendingDeleteSessionId,
    ...preferences,
    refreshSessions,
    switchToSession,
    startSession,
    createEphemeralSession,
    goToHome,
    saveSessionTitle,
    renameTarget,
    requestDeleteSession,
    performDeleteSession,
  };
}
