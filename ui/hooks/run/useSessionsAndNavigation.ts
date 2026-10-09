import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useLayoutEffect,
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
import { whileRunning } from "../../lib/whileRunning";
import {
  createSessionApi,
  deleteSessionApi,
  fetchSession,
  fetchSessionSummaries,
  patchSessionApi,
} from "../../persist/sessions";
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

/** Reuses unchanged summaries, so their chat list rows skip rendering. */
function keepUnchangedSummaries(
  current: SessionSummary[],
  next: SessionSummary[],
): SessionSummary[] {
  const previous = new Map(current.map((session) => [session.id, session]));
  return next.map((session) => {
    const old = previous.get(session.id);
    return old &&
      old.updatedAt === session.updatedAt &&
      old.preview === session.preview &&
      old.customTitle === session.customTitle &&
      old.badge === session.badge &&
      old.expiresAt === session.expiresAt
      ? old
      : session;
  });
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

export function useSessionsAndNavigation({
  ollamaModels,
  userSettingsDefaultModel,
  messages,
  setMessages,
  setEditingUserIndex,
  setTruncateConfirm,
  setStepsModalData,
  setDebugOpen,
  setDebugData,
  activeSessionIdRef,
  onNavigate,
}: Args) {
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
      setSessions((current) => keepUnchangedSummaries(current, list));
    } catch (e) {
      console.error(e);
      setSessions([]);
    }
  }, []);

  const preferences = useSessionPreferences({
    activeSessionIdRef,
    ollamaModels: ollamaModels,
    userSettingsDefaultModel: userSettingsDefaultModel,
    refreshSessions,
    setMessages: setMessages,
  });
  const { selectedModel, setSessionModel, setThinkingEffort, setWorkspace } =
    preferences;

  const loadGenRef = useRef(0);
  const restoreDoneRef = useRef(false);

  useLayoutEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  });

  const resetSessionTransientState = useCallback(() => {
    setMessages([]);
    setEditingUserIndex(null);
    setTruncateConfirm(null);
    setStepsModalData(null);
    setDebugOpen(false);
    setDebugData(null);
    setThinkingEffort(null);
    setSessionModel(null);
  }, [
    setMessages,
    setEditingUserIndex,
    setTruncateConfirm,
    setStepsModalData,
    setDebugOpen,
    setDebugData,
    setThinkingEffort,
    setSessionModel,
  ]);

  const canDiscardEmptySession =
    messages.length === 0 && sessionLoadState === "empty";

  // Leaving a chat that never received a message deletes it.
  const discardEmptySession = useCallback(async () => {
    const curId = activeSessionIdRef.current;
    if (!curId || !canDiscardEmptySession) return;
    try {
      await deleteSessionApi(curId);
    } catch (e) {
      console.error(e);
    }
    await refreshSessions();
  }, [activeSessionIdRef, canDiscardEmptySession, refreshSessions]);

  const loadSession = useCallback(
    async (id: string) => {
      const gen = ++loadGenRef.current;
      activeSessionIdRef.current = id;
      setActiveSessionId(id);
      setActiveExpiresAt(null);
      setSessionLoadState("loading");
      setSessionError(null);
      setThinkingEffort(null);
      const cleared: Message[] = [];
      setMessages(cleared);
      setEditingUserIndex(null);
      setTruncateConfirm(null);

      const fail = (message: string) => {
        if (gen !== loadGenRef.current) return;
        setSessionError(message);
        setSessionLoadState("error");
      };
      await fetchSession(id).then(
        (stored) => {
          if (gen !== loadGenRef.current) return;
          if (!stored) return fail("Conversation not found.");
          setActiveExpiresAt(stored.expiresAt);
          setSessionModel(stored.model ?? null);
          setWorkspace(stored.workspace ?? { kind: "sandbox" });
          // The runtime snapshot may have set newer history while this
          // request was in flight. Never replace that newer state.
          setMessages((current) =>
            gen === loadGenRef.current && current === cleared
              ? stored.history
              : current,
          );
          setSessionLoadState(stored.history.length > 0 ? "loaded" : "empty");
        },
        (error: unknown) =>
          fail(
            error instanceof Error
              ? error.message
              : "Could not load conversation.",
          ),
      );
    },
    [
      activeSessionIdRef,
      setMessages,
      setEditingUserIndex,
      setTruncateConfirm,
      setThinkingEffort,
      setSessionModel,
      setWorkspace,
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
    const id = activeSessionIdRef.current;
    if (id) void loadSession(id);
  }, [loadSession, activeSessionIdRef]);

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
      if (activeSessionIdRef.current !== id) void discardEmptySession();
      pushSessionUrl(id);
      await loadSession(id);
      onNavigate?.();
    },
    [loadSession, activeSessionIdRef, onNavigate, discardEmptySession],
  );

  /** Saves the chat started from Home and opens it without reloading. */
  const startSession = useCallback(
    () =>
      whileRunning(setStartingSession, async () => {
        const { id, expiresAt } = await createSessionApi({
          model: selectedModel || null,
        });
        loadGenRef.current++;
        activeSessionIdRef.current = id;
        setActiveSessionId(id);
        setActiveExpiresAt(expiresAt);
        setSessionLoadState("empty");
        setSessionError(null);
        setSessionModel(selectedModel || null);
        pushSessionUrl(id);
        void refreshSessions();
        return id;
      }),
    [activeSessionIdRef, selectedModel, setSessionModel, refreshSessions],
  );

  /** Opens a new chat that is deleted once its lifetime ends. */
  const createEphemeralSession = useCallback(async () => {
    await discardEmptySession();
    const { id, expiresAt } = await createSessionApi({ ephemeral: true });
    loadGenRef.current++;
    activeSessionIdRef.current = id;
    setActiveSessionId(id);
    setActiveExpiresAt(expiresAt);
    resetSessionTransientState();
    setSessionLoadState("empty");
    setSessionError(null);
    setWorkspace({ kind: "sandbox" });
    pushSessionUrl(id);
    void refreshSessions();
    onNavigate?.();
  }, [
    activeSessionIdRef,
    onNavigate,
    discardEmptySession,
    refreshSessions,
    resetSessionTransientState,
    setWorkspace,
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
      if (urlId === activeSessionIdRef.current) return;
      void discardEmptySession();
      if (urlId) {
        void loadSession(urlId);
      } else {
        loadGenRef.current++;
        activeSessionIdRef.current = null;
        setActiveSessionId(null);
        setActiveExpiresAt(null);
        setWorkspace({ kind: "sandbox" });
        resetSessionTransientState();
      }
    };
    window.addEventListener(NAVIGATION_EVENT, onPopState);
    return () => window.removeEventListener(NAVIGATION_EVENT, onPopState);
  }, [
    loadSession,
    discardEmptySession,
    activeSessionIdRef,
    resetSessionTransientState,
    setWorkspace,
  ]);

  const goToHome = useCallback(async () => {
    loadGenRef.current++;
    await discardEmptySession();
    setActiveSessionId(null);
    setActiveExpiresAt(null);
    resetSessionTransientState();
    onNavigate?.();
    setWorkspace({ kind: "sandbox" });
    pushSessionUrl(null);
  }, [
    onNavigate,
    discardEmptySession,
    resetSessionTransientState,
    setWorkspace,
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
        activeSessionIdRef.current = null;
        setActiveSessionId(null);
        setActiveExpiresAt(null);
        setWorkspace({ kind: "sandbox" });
        setSessionModel(null);
        setMessages([]);
        setDebugOpen(false);
        setDebugData(null);
        setEditingUserIndex(null);
        setTruncateConfirm(null);
        replaceSessionUrl(null);
      }
      await refreshSessions();
    },
    [
      activeSessionId,
      activeSessionIdRef,
      setDebugData,
      setDebugOpen,
      setEditingUserIndex,
      setMessages,
      setTruncateConfirm,
      refreshSessions,
      setWorkspace,
      setSessionModel,
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
      // A chat that cannot be loaded still asks before deleting.
      const empty = await fetchSession(id).then(
        (full) => !full?.history?.length,
        () => false,
      );
      if (empty) {
        await dropSessionFromApp(id);
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
      const customTitle = title.trim() || null;
      try {
        await patchSessionApi(id, { customTitle });
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
