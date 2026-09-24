import { type MutableRefObject, useCallback } from "react";
import { fetchSession } from "../../persist/sessions";
import { userScopedFetch } from "../../persist/userIdentity";
import { buildRunMetadata } from "../../persist/userSettings";
import type { UserSettings } from "../../persist/userSettings";
import type { DebugData } from "../../types";

type Args = {
  userSettingsRef: MutableRefObject<UserSettings>;
  isEphemeralRef: MutableRefObject<boolean>;
  setDebugData: (data: DebugData | null) => void;
};

export function useRunDebug({
  userSettingsRef,
  isEphemeralRef,
  setDebugData,
}: Args) {
  return useCallback(
    async (sessionId: string, message = "") => {
      try {
        const settings = userSettingsRef.current;
        const metadata = buildRunMetadata(settings);

        const [promptRes, stored] = await Promise.all([
          userScopedFetch("/api/runs/debug-prompt", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              metadata,
              message,
              ephemeral: isEphemeralRef.current,
            }),
          }),
          isEphemeralRef.current ? null : fetchSession(sessionId),
        ]);

        if (!promptRes.ok) {
          throw new Error(
            "Failed to load the system prompt preview. Try again.",
          );
        }
        const promptData = (await promptRes.json()) as { systemPrompt: string };
        const systemPrompt = promptData.systemPrompt;

        setDebugData({
          systemPrompt,
          history: stored?.history ?? [],
          customTitle: stored?.customTitle ?? null,
          modelMessages: stored?.modelMessages,
        });
      } catch (error) {
        console.error("Failed to load debug data", error);
        setDebugData({
          systemPrompt: "",
          history: [],
          customTitle: null,
          error:
            "Failed to load the debug preview. Close and reopen it to retry.",
        });
      }
    },
    [isEphemeralRef, setDebugData, userSettingsRef],
  );
}
