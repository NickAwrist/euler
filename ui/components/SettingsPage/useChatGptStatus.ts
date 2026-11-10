import { useEffect, useState } from "react";
import type { ChatGptStatus as Status } from "../../../src/gen/euler/v1/providers_pb";
import { loadChatGptStatus } from "../../persist/chatgpt";

/** Keeps account data for the settings or onboarding page, across tab changes. */
export function useChatGptStatus() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadChatGptStatus(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setStatus(value);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setLoadError("Could not load ChatGPT account.");
      });
    return () => controller.abort();
  }, []);

  return { status, loadError, setStatus };
}
