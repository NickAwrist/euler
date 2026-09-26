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
  patchSessionApi,
  selectSessionDirectory,
  useSessionSandbox,
} from "../../persist/sessions";
import type { UserSettings } from "../../persist/userSettings";
import type { Message, ModelOption, SessionWorkspace } from "../../types";

export interface UseSessionPreferencesOptions {
  activeSessionIdRef: MutableRefObject<string | null>;
  isEphemeralRef: MutableRefObject<boolean>;
  userSettingsRef: MutableRefObject<UserSettings>;
  ollamaModels: ModelOption[];
  userSettingsDefaultModel: string;
  refreshSessions: () => Promise<void>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
}

export function useSessionPreferences({
  activeSessionIdRef,
  isEphemeralRef,
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
      if (isEphemeralRef.current) return;
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
    [activeSessionIdRef, isEphemeralRef, refreshSessions],
  );

  const chooseDirectory = useCallback(
    async (path: string) => {
      const sid = activeSessionIdRef.current;
      if (!sid) return;
      const temporary = isEphemeralRef.current;
      const selected = await selectSessionDirectory(sid, path, temporary);
      if (activeSessionIdRef.current === sid) {
        setWorkspace(selected);
        if (temporary) {
          setMessages((messages) => [
            ...messages,
            {
              role: "event",
              content: `Working directory changed to ${selected.kind === "local" ? selected.path : "the private workspace"}`,
            },
          ]);
          return;
        }
        const refreshed = await fetchSession(sid);
        if (refreshed && activeSessionIdRef.current === sid) {
          setMessages(refreshed.history);
        }
      }
    },
    [activeSessionIdRef, isEphemeralRef, setMessages],
  );

  const returnToSandbox = useCallback(async () => {
    const sid = activeSessionIdRef.current;
    if (!sid || workspace.kind !== "local" || returningToSandboxRef.current)
      return;
    returningToSandboxRef.current = true;
    try {
      const temporary = isEphemeralRef.current;
      setWorkspace(await useSessionSandbox(sid, temporary));
      if (temporary) {
        setMessages((messages) => [
          ...messages,
          { role: "event", content: "Returned to the private workspace" },
        ]);
        return;
      }
      const refreshed = await fetchSession(sid);
      if (refreshed) setMessages(refreshed.history);
    } finally {
      returningToSandboxRef.current = false;
    }
  }, [activeSessionIdRef, isEphemeralRef, setMessages, workspace.kind]);

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
    returnToSandbox,
  };
}
