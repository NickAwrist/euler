import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { effectiveDefaultRunModel } from "../../lib/defaultModel";
import {
  fetchSession,
  linkSessionWorkspace,
  patchSessionApi,
  selectSessionDirectory,
  useSessionSandbox,
} from "../../persist/sessions";
import type { UserSettings } from "../../persist/userSettings";
import type { Message, ModelOption, SessionWorkspace } from "../../types";

export interface UseSessionPreferencesOptions {
  activeSessionIdRef: MutableRefObject<string | null>;
  userSettingsRef: MutableRefObject<UserSettings>;
  ollamaModels: ModelOption[];
  userSettingsDefaultModel: string;
  refreshSessions: () => Promise<void>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
}

export function useSessionPreferences({
  activeSessionIdRef,
  userSettingsRef,
  ollamaModels,
  userSettingsDefaultModel,
  refreshSessions,
  setMessages,
}: UseSessionPreferencesOptions) {
  const [selectedModel, setSelectedModel] = useState(() =>
    effectiveDefaultRunModel(
      userSettingsRef.current.defaultModel,
      ollamaModels,
    ),
  );
  const [sessionModel, setSessionModel] = useState<string | null>(null);
  const [thinkingEffort, setThinkingEffort] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<SessionWorkspace>({
    kind: "sandbox",
  });
  const returningToSandboxRef = useRef(false);

  useEffect(() => {
    setSelectedModel(
      sessionModel?.trim() ||
        effectiveDefaultRunModel(
          userSettingsRef.current.defaultModel,
          ollamaModels,
        ),
    );
  }, [sessionModel, ollamaModels, userSettingsRef, userSettingsDefaultModel]);

  const handleThinkingEffortChange = useCallback((effort: string) => {
    setThinkingEffort(effort);
  }, []);

  const handleModelChange = useCallback(
    async (model: string) => {
      setSelectedModel(model);
      setSessionModel(model);
      setThinkingEffort(null);
      const sid = activeSessionIdRef.current;
      if (sid) {
        try {
          await patchSessionApi(sid, { model });
          await refreshSessions();
        } catch (e) {
          console.error(e);
        }
      }
    },
    [activeSessionIdRef, refreshSessions],
  );

  /** Shows a changed workspace and the event it recorded, if still active. */
  const applyWorkspace = useCallback(
    async (sid: string, next: SessionWorkspace) => {
      if (activeSessionIdRef.current !== sid) return;
      setWorkspace(next);
      const refreshed = await fetchSession(sid);
      if (refreshed && activeSessionIdRef.current === sid) {
        setMessages(refreshed.history);
      }
    },
    [activeSessionIdRef, setMessages],
  );

  const chooseDirectory = useCallback(
    async (path: string) => {
      const sid = activeSessionIdRef.current;
      if (sid)
        await applyWorkspace(sid, await selectSessionDirectory(sid, path));
    },
    [activeSessionIdRef, applyWorkspace],
  );

  const linkWorkspace = useCallback(
    async (sourceSessionId: string) => {
      const sid = activeSessionIdRef.current;
      if (sid)
        await applyWorkspace(
          sid,
          await linkSessionWorkspace(sid, sourceSessionId),
        );
    },
    [activeSessionIdRef, applyWorkspace],
  );

  const privateSandbox = workspace.kind === "sandbox" && !workspace.linked;
  const returnToSandbox = useCallback(async () => {
    const sid = activeSessionIdRef.current;
    if (!sid || privateSandbox || returningToSandboxRef.current) return;
    returningToSandboxRef.current = true;
    try {
      await applyWorkspace(sid, await useSessionSandbox(sid));
    } finally {
      returningToSandboxRef.current = false;
    }
  }, [activeSessionIdRef, applyWorkspace, privateSandbox]);

  return {
    selectedModel,
    setSelectedModel,
    sessionModel,
    setSessionModel,
    thinkingEffort,
    setThinkingEffort,
    workspace,
    setWorkspace,
    handleThinkingEffortChange,
    handleModelChange,
    chooseDirectory,
    linkWorkspace,
    returnToSandbox,
  };
}
