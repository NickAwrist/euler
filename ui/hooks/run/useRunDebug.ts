import { type MutableRefObject, useCallback } from "react";
import { fetchSession } from "../../persist/sessions";
import { userScopedFetch } from "../../persist/userIdentity";
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

  const [promptRes, stored] = await Promise.all([
    userScopedFetch("/api/sessions/debug-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, metadata, message }),
    }),
    fetchSession(sessionId),
  ]);

  if (!promptRes.ok) {
    throw new Error("Failed to load the system prompt preview. Try again.");
  }
  const promptData = (await promptRes.json()) as { systemPrompt: string };
  const systemPrompt = promptData.systemPrompt;

  return {
    systemPrompt,
    history: stored?.history ?? [],
    customTitle: stored?.customTitle ?? null,
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
            customTitle: null,
            error:
              "Failed to load the debug preview. Close and reopen it to retry.",
          });
        },
      ),
    [setDebugData, userSettingsRef],
  );
}
