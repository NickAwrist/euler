import { useCallback, useEffect, useRef, useState } from "react";
import type { ListModelsResponse } from "../../../src/gen/euler/v1/models_pb";
import { OllamaContextWindow } from "../../../src/gen/euler/v1/providers_pb";
import { modelClient, providerClient } from "../../lib/rpc";
import type { ModelOption } from "../../types";
import { OLLAMA_HEALTH_POLL_MS } from "./constants";

const chatgptCatalogErrorOf = (data: ListModelsResponse) =>
  data.providers?.chatgpt?.error ?? null;

export function useOllamaConnection() {
  const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [modelsLoadError, setModelsLoadError] = useState<string | null>(null);
  const [chatgptCatalogError, setChatgptCatalogError] = useState<string | null>(
    null,
  );
  const [ollamaHost, setOllamaHost] = useState("");
  const [ollamaContextWindow, setOllamaContextWindow] = useState(
    OllamaContextWindow.LOW,
  );
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null);

  const fetchOllamaHealth = useCallback(async () => {
    try {
      const { connected } = await providerClient.getOllamaHealth({});
      setOllamaConnected(connected);
    } catch {
      setOllamaConnected(false);
    }
  }, []);

  useEffect(() => {
    void fetchOllamaHealth();
    const id = window.setInterval(
      () => void fetchOllamaHealth(),
      OLLAMA_HEALTH_POLL_MS,
    );
    return () => window.clearInterval(id);
  }, [fetchOllamaHealth]);

  const ollamaReady = ollamaConnected === true;

  const modelRequestId = useRef(0);
  const refreshOllamaModels = useCallback(async (cached = false) => {
    const requestId = ++modelRequestId.current;
    try {
      const data = await modelClient.listModels({ cachedCatalog: cached });
      if (requestId !== modelRequestId.current) return;
      setModelsLoadError(null);
      setChatgptCatalogError(chatgptCatalogErrorOf(data));
      setOllamaModels(data.models);
      setCatalogLoaded(true);
    } catch (e) {
      if (requestId !== modelRequestId.current) return;
      setModelsLoadError(e instanceof Error ? e.message : String(e));
      setOllamaModels([]);
      setCatalogLoaded(true);
    }
  }, []);

  useEffect(() => {
    const refresh = () => void refreshOllamaModels(true);
    window.addEventListener("model-preferences-changed", refresh);
    return () =>
      window.removeEventListener("model-preferences-changed", refresh);
  }, [refreshOllamaModels]);

  useEffect(() => {
    void refreshOllamaModels();
  }, [ollamaConnected, refreshOllamaModels]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { config, contextWindow } = await providerClient.getOllamaConfig(
          {},
        );
        if (cancelled) return;
        if (config) setOllamaHost(config.host);
        if (contextWindow) setOllamaContextWindow(contextWindow);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    ollamaModels,
    catalogLoaded,
    modelsLoadError,
    chatgptCatalogError,
    ollamaHost,
    setOllamaHost,
    ollamaContextWindow,
    setOllamaContextWindow,
    ollamaConnected,
    fetchOllamaHealth,
    refreshOllamaModels,
    ollamaReady,
  };
}
