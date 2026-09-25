import { useCallback, useEffect, useRef, useState } from "react";
import {
  parseInputCapabilities,
  parseModelReasoning,
} from "../../../src/modelCapabilities";
import { readApiError } from "../../lib/readApiError";
import type { ModelOption, ModelReasoning } from "../../types";
import { OLLAMA_HEALTH_POLL_MS } from "./constants";

export function mapModelOptions(value: unknown): ModelOption[] {
  const raw = Array.isArray(value) ? value : [];
  return raw
    .filter(
      (m): m is Record<string, unknown> => m != null && typeof m === "object",
    )
    .filter(
      (
        m,
      ): m is Record<string, unknown> & {
        id: string;
        name: string;
        provider: "ollama" | "openrouter";
        lab: string;
      } =>
        typeof m.id === "string" &&
        typeof m.name === "string" &&
        (m.provider === "ollama" || m.provider === "openrouter") &&
        typeof m.lab === "string",
    )
    .map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      lab: m.lab,
      favorite: m.favorite === true,
      isNew: m.isNew === true,
      created:
        typeof m.created === "number" && Number.isFinite(m.created)
          ? m.created
          : undefined,
      ...(typeof m.publisherId === "string"
        ? { publisherId: m.publisherId }
        : {}),
      ...(typeof m.supportsTools === "boolean"
        ? { supportsTools: m.supportsTools }
        : {}),
      contextLength:
        typeof m.contextLength === "number" ? m.contextLength : null,
      promptPricePerMillion:
        typeof m.promptPricePerMillion === "number"
          ? m.promptPricePerMillion
          : null,
      completionPricePerMillion:
        typeof m.completionPricePerMillion === "number"
          ? m.completionPricePerMillion
          : null,
      ...(m.availability === "available" ||
      m.availability === "unavailable" ||
      m.availability === "unverified"
        ? { availability: m.availability }
        : {}),
      ...(typeof m.route === "string" ? { route: m.route } : {}),
      ...(typeof m.configured === "boolean"
        ? { configured: m.configured }
        : {}),
      inputCapabilities: parseInputCapabilities(m.inputCapabilities),
      ...(m.reasoning ? { reasoning: parseModelReasoning(m.reasoning) } : {}),
    }));
}

export function useOllamaConnection() {
  const [ollamaModels, setOllamaModels] = useState<ModelOption[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [modelsLoadError, setModelsLoadError] = useState<string | null>(null);
  const [ollamaHost, setOllamaHost] = useState("");
  const [ollamaConnected, setOllamaConnected] = useState<boolean | null>(null);

  const fetchOllamaHealth = useCallback(async () => {
    try {
      const res = await fetch("/api/ollama/health");
      const data = (await res.json().catch(() => ({}))) as {
        connected?: boolean;
      };
      if (!res.ok) {
        setOllamaConnected(false);
        return;
      }
      setOllamaConnected(data.connected === true);
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
      const res = await fetch(
        cached ? "/api/models?catalog=cached" : "/api/models",
      );
      if (requestId !== modelRequestId.current) return;
      if (!res.ok) {
        setModelsLoadError(await readApiError(res));
        setOllamaModels([]);
        setCatalogLoaded(true);
        return;
      }
      const data = (await res.json()) as {
        models?: unknown;
      };
      if (requestId !== modelRequestId.current) return;
      setModelsLoadError(null);
      const list = mapModelOptions(data.models);
      setOllamaModels(list);
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
        const res = await fetch("/api/ollama/config");
        const data = (await res.json().catch(() => ({}))) as { host?: string };
        if (cancelled) return;
        if (typeof data.host === "string") setOllamaHost(data.host);
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
    ollamaHost,
    setOllamaHost,
    ollamaConnected,
    fetchOllamaHealth,
    refreshOllamaModels,
    ollamaReady,
  };
}
