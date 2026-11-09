import { type MutableRefObject, useCallback } from "react";
import { debugClient } from "../../lib/rpc";
import { fetchSession } from "../../persist/sessions";
import { buildRunMetadata } from "../../persist/userSettings";
import type { UserSettings } from "../../persist/userSettings";
import type { DebugData } from "../../types";

type Args = {
  userSettingsRef: MutableRefObject<UserSettings>;
  setDebugData: (data: DebugData | null) => void;
};

async function loadDebugData(
  sessionId: string,
  settings: UserSettings,
  message: string,
): Promise<DebugData> {
  const metadata = buildRunMetadata(settings);

  const [{ systemPrompt }, stored] = await Promise.all([
    debugClient.previewPrompt({ sessionId, metadata, message }),
    fetchSession(sessionId),
  ]);
  return {
    systemPrompt,
    history: stored?.history ?? [],
    customTitle: stored?.customTitle,
    modelMessages: stored?.modelMessages,
  };
}

export function useRunDebug({ userSettingsRef, setDebugData }: Args) {
  return useCallback(
    (sessionId: string, message = "") =>
      loadDebugData(sessionId, userSettingsRef.current, message).then(
        setDebugData,
        (error: unknown) => {
          console.error("Failed to load debug data", error);
          setDebugData({
            systemPrompt: "",
            history: [],
            error:
              "Failed to load the debug preview. Close and reopen it to retry.",
          });
        },
      ),
    [setDebugData, userSettingsRef],
  );
}
