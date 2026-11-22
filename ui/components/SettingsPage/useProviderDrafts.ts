import { useEffect, useRef, useState } from "react";
import { useSavedDraft } from "../../hooks/useSavedDraft";
import { testOllamaHost } from "../../persist/services";
import type { ConnectionTestState } from "./types";

/** What a summary can claim: only a test or health check proves a connection. */
export type ServiceStatus = "connected" | "configured" | "unreachable" | null;

function connectedLabel(version: string | undefined): string {
  return version ? `Connected - Ollama version ${version}` : "Connected";
}

/** Draft Ollama server address with connection testing; saving stays with the caller. */
export function useOllamaDraft(savedHost: string, connected: boolean | null) {
  const draft = useSavedDraft(savedHost);
  const [testState, setTestState] = useState<ConnectionTestState>({
    status: "idle",
  });
  const dirty = draft.value !== savedHost;
  const savedConnected = dirty ? null : connected;
  const testRequest = useRef(0);
  useEffect(() => {
    testRequest.current++;
    setTestState({ status: "idle" });
    return () => {
      testRequest.current++;
    };
  }, [savedHost]);

  const test = async () => {
    const request = ++testRequest.current;
    setTestState((previous) => ({
      status: "loading",
      holdLabel:
        previous.status === "ok"
          ? previous.label
          : previous.status === "idle" && savedConnected === true
            ? "Connected"
            : undefined,
    }));
    try {
      const { version } = await testOllamaHost(draft.value);
      if (request === testRequest.current)
        setTestState({ status: "ok", label: connectedLabel(version) });
    } catch (e) {
      if (request !== testRequest.current) return;
      setTestState({
        status: "err",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const status: ServiceStatus =
    testState.status === "ok"
      ? "connected"
      : testState.status === "err"
        ? "unreachable"
        : !dirty && connected === true
          ? "connected"
          : draft.value.trim()
            ? "configured"
            : null;

  return {
    host: draft.value,
    connected: savedConnected,
    onHostInput: (value: string) => {
      testRequest.current++;
      draft.setValue(value);
      setTestState({ status: "idle" });
    },
    dirty,
    testState,
    test,
    status,
    reset: () => {
      testRequest.current++;
      draft.reset();
      setTestState({ status: "idle" });
    },
    accept: () => {
      testRequest.current++;
      draft.accept();
      setTestState({ status: "idle" });
    },
  };
}
