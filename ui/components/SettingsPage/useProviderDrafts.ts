import { useCallback, useEffect, useRef, useState } from "react";
import { useSavedDraft } from "../../hooks/useSavedDraft";
import { changedFields } from "../../lib/changedFields";
import { loadComfyUIModels, testServiceHost } from "../../persist/services";
import type { ComfyUIConfigPayload } from "../../types";
import { parseSize, sizeKey } from "./constants";
import type { ConnectionTestState } from "./types";

/** What a summary can claim: only a test or health check proves a connection. */
export type ServiceStatus = "connected" | "configured" | "unreachable" | null;

/** Draft server address with connection testing; saving stays with the caller. */
function useServerHostDraft(
  savedHost: string,
  connected: boolean | null,
  testHost: (host: string) => Promise<string>,
) {
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
      const label = await testHost(draft.value);
      if (request === testRequest.current)
        setTestState({ status: "ok", label });
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

export function useOllamaDraft(savedHost: string, connected: boolean | null) {
  return useServerHostDraft(savedHost, connected, async (host) => {
    const { version } = await testServiceHost("ollama", host);
    return version ? `Connected - Ollama version ${version}` : "Connected";
  });
}

export function useComfyUIDraft(
  saved: Required<ComfyUIConfigPayload>,
  connected: boolean | null,
) {
  const [models, setModels] = useState<string[]>([]);
  const refreshModels = useCallback(async () => {
    try {
      setModels(await loadComfyUIModels());
    } catch {
      /* Keep the last loaded checkpoints. */
    }
  }, []);
  useEffect(() => {
    if (connected) void refreshModels();
  }, [connected, refreshModels]);

  const server = useServerHostDraft(saved.host, connected, async (host) => {
    await testServiceHost("comfyui", host);
    void refreshModels();
    return "Connected";
  });
  const model = useSavedDraft(saved.defaultModel);
  const savedSize = sizeKey(saved.defaultWidth, saved.defaultHeight);
  const size = useSavedDraft(savedSize);
  const negative = useSavedDraft(saved.negativePrompt);

  const changes = (
    [
      ["ComfyUI server URL", server.dirty],
      ["Default checkpoint model", model.value !== saved.defaultModel],
      ["Default image size", size.value !== savedSize],
      ["Negative prompt", negative.value !== saved.negativePrompt],
    ] as const
  )
    .filter(([, changed]) => changed)
    .map(([label]) => label);
  const { width, height } = parseSize(size.value);
  // Only edited fields, so saving never overwrites another device's changes.
  const patch: ComfyUIConfigPayload = {
    ...(server.dirty ? { host: server.host } : {}),
    ...changedFields(
      {
        defaultModel: model.value,
        defaultWidth: width,
        defaultHeight: height,
        negativePrompt: negative.value,
      },
      {
        defaultModel: saved.defaultModel,
        defaultWidth: saved.defaultWidth,
        defaultHeight: saved.defaultHeight,
        negativePrompt: saved.negativePrompt,
      },
    ),
  };

  return {
    server,
    model: model.value,
    setModel: model.setValue,
    models,
    size: size.value,
    setSize: size.setValue,
    negative: negative.value,
    setNegative: negative.setValue,
    changes,
    patch,
    reset: () => {
      server.reset();
      model.reset();
      size.reset();
      negative.reset();
    },
    accept: () => {
      server.accept();
      model.accept();
      size.accept();
      negative.accept();
    },
  };
}
