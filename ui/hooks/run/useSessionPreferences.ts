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
import { whileRunning } from "../../lib/whileRunning";
import {
  fetchSession,
  linkSessionWorkspace,
  patchSessionApi,
  selectSessionDirectory,
  switchSessionToSandbox,
} from "../../persist/sessions";
import type { Message, ModelOption, SessionWorkspace } from "../../types";

export interface UseSessionPreferencesOptions {
  activeSessionIdRef: MutableRefObject<string | null>;
  ollamaModels: ModelOption[];
  userSettingsDefaultModel: string;
  refreshSessions: () => Promise<void>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
}

export function useSessionPreferences({
  activeSessionIdRef,
  ollamaModels,
  userSettingsDefaultModel,
  refreshSessions,
  setMessages,
}: UseSessionPreferencesOptions) {
  const [selectedModel, setSelectedModel] = useState(() =>
    effectiveDefaultRunModel(userSettingsDefaultModel, ollamaModels),
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
        effectiveDefaultRunModel(userSettingsDefaultModel, ollamaModels),
    );
  }, [sessionModel, ollamaModels, userSettingsDefaultModel]);

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

  const returnToSandbox = useCallback(async () => {
    const sid = activeSessionIdRef.current;
    if (!sid || returningToSandboxRef.current) return;
    await whileRunning(
      (running) => {
        returningToSandboxRef.current = running;
      },
      async () => applyWorkspace(sid, await switchSessionToSandbox(sid)),
    );
  }, [activeSessionIdRef, applyWorkspace]);

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
