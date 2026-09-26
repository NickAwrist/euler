import { useCallback, useEffect, useMemo, useState } from "react";
import type { UserSettings } from "../../persist/userSettings";
import type {
  ComfyUIConfigPayload,
  ModelOption,
  SearXNGConfigPayload,
  SettingsTab,
} from "../../types";
import { parseSize, sizeKey } from "./constants";
import type {
  ComfyUITestState,
  OllamaTestState,
  SearXNGTestState,
  SettingChange,
} from "./types";

type Args = {
  ollamaModels: ModelOption[];
  currentSettings: UserSettings;
  ollamaHost: string;
  ollamaConnected: boolean | null;
  comfyuiHost: string;
  comfyuiConnected: boolean | null;
  comfyuiDefaultModel: string;
  comfyuiDefaultWidth: number;
  comfyuiDefaultHeight: number;
  comfyuiNegativePrompt: string;
  searxngHost: string;
  searxngConnected: boolean | null;
  onSave: (
    settings: UserSettings,
    ollamaHost: string,
    comfyui?: ComfyUIConfigPayload,
    searxng?: SearXNGConfigPayload,
  ) => Promise<void>;
};

export function useSettingsPageState({
  ollamaModels,
  currentSettings,
  ollamaHost,
  ollamaConnected,
  comfyuiHost,
  comfyuiConnected,
  comfyuiDefaultModel,
  comfyuiDefaultWidth,
  comfyuiDefaultHeight,
  comfyuiNegativePrompt,
  searxngHost,
  searxngConnected,
  onSave,
}: Args) {
  const [settings, setSettings] = useState<UserSettings>(currentSettings);
  const [ollamaUri, setOllamaUri] = useState(ollamaHost);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testState, setTestState] = useState<OllamaTestState>({
    status: "idle",
  });

  const [comfyUri, setComfyUri] = useState(comfyuiHost);
  const [comfyModel, setComfyModel] = useState(comfyuiDefaultModel);
  const [comfySize, setComfySize] = useState(
    sizeKey(comfyuiDefaultWidth, comfyuiDefaultHeight),
  );
  const [comfyModels, setComfyModels] = useState<string[]>([]);
  const [comfyTestState, setComfyTestState] = useState<ComfyUITestState>({
    status: "idle",
  });
  const [comfyNegative, setComfyNegative] = useState(comfyuiNegativePrompt);
  const [searxngUri, setSearxngUri] = useState(searxngHost);
  const [searxngTestState, setSearxngTestState] = useState<SearXNGTestState>({
    status: "idle",
  });

  useEffect(() => {
    setSettings(currentSettings);
  }, [currentSettings]);
  useEffect(() => {
    setOllamaUri(ollamaHost);
  }, [ollamaHost]);
  useEffect(() => {
    setComfyUri(comfyuiHost);
  }, [comfyuiHost]);
  useEffect(() => {
    setComfyModel(comfyuiDefaultModel);
  }, [comfyuiDefaultModel]);
  useEffect(() => {
    setComfySize(sizeKey(comfyuiDefaultWidth, comfyuiDefaultHeight));
  }, [comfyuiDefaultWidth, comfyuiDefaultHeight]);
  useEffect(() => {
    setComfyNegative(comfyuiNegativePrompt);
  }, [comfyuiNegativePrompt]);
  useEffect(() => {
    setSearxngUri(searxngHost);
  }, [searxngHost]);

  useEffect(() => {
    if (comfyuiConnected) {
      void (async () => {
        try {
          const res = await fetch("/api/comfyui/models");
          const data = (await res.json()) as { models?: string[] };
          if (Array.isArray(data.models)) setComfyModels(data.models);
        } catch {
          /* ignore */
        }
      })();
    }
  }, [comfyuiConnected]);

  const handleChange = useCallback(
    <K extends keyof UserSettings>(field: K, value: UserSettings[K]) => {
      setSettings((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleTestOllama = useCallback(async () => {
    setTestState((prev) => {
      if (prev.status === "ok") {
        return { status: "loading", previousVersion: prev.version };
      }
      if (prev.status === "idle" && ollamaConnected === true) {
        return { status: "loading", holdSavedConnected: true };
      }
      return { status: "loading" };
    });
    setError(null);
    try {
      const res = await fetch("/api/ollama/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: ollamaUri }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        version?: string;
        error?: string;
      };
      if (data.ok && typeof data.version === "string") {
        setTestState({ status: "ok", version: data.version });
      } else {
        setTestState({
          status: "err",
          message: data.error || "Connection failed",
        });
      }
    } catch (e) {
      setTestState({
        status: "err",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [ollamaUri, ollamaConnected]);

  const handleTestComfyUI = useCallback(async () => {
    setComfyTestState((prev) => ({
      status: "loading",
      holdConnected:
        prev.status === "ok" ||
        (prev.status === "idle" && comfyuiConnected === true),
    }));
    try {
      const res = await fetch("/api/comfyui/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: comfyUri }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setComfyTestState({ status: "ok" });
        try {
          const mRes = await fetch("/api/comfyui/models");
          const mData = (await mRes.json()) as { models?: string[] };
          if (Array.isArray(mData.models)) setComfyModels(mData.models);
        } catch {
          /* ignore */
        }
      } else {
        setComfyTestState({
          status: "err",
          message: data.error || "Connection failed",
        });
      }
    } catch (e) {
      setComfyTestState({
        status: "err",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [comfyUri, comfyuiConnected]);

  const handleTestSearXNG = useCallback(async () => {
    setSearxngTestState((prev) => ({
      status: "loading",
      holdConnected:
        prev.status === "ok" ||
        (prev.status === "idle" && searxngConnected === true),
    }));
    try {
      const res = await fetch("/api/searxng/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: searxngUri }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (data.ok) {
        setSearxngTestState({ status: "ok" });
      } else {
        setSearxngTestState({
          status: "err",
          message: data.error || "Connection failed",
        });
      }
    } catch (e) {
      setSearxngTestState({
        status: "err",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }, [searxngUri, searxngConnected]);

  const savedComfySize = useMemo(
    () => sizeKey(comfyuiDefaultWidth, comfyuiDefaultHeight),
    [comfyuiDefaultWidth, comfyuiDefaultHeight],
  );

  const changes = useMemo((): SettingChange[] => {
    const settingChanges: [SettingsTab, string, boolean][] = [
      ["general", "Name", settings.name !== currentSettings.name],
      ["general", "Location", settings.location !== currentSettings.location],
      [
        "general",
        "Preferred response formats",
        settings.preferredFormats !== currentSettings.preferredFormats,
      ],
      [
        "general",
        "Include current date",
        settings.includeCurrentDate !== currentSettings.includeCurrentDate,
      ],
      [
        "general",
        "System prompt",
        settings.systemPrompt !== currentSettings.systemPrompt,
      ],
      [
        "general",
        "Default model",
        settings.defaultModel !== currentSettings.defaultModel,
      ],
      [
        "general",
        "Display debug button",
        settings.showDebugButton !== currentSettings.showDebugButton,
      ],
      ["ollama", "Ollama server URL", ollamaUri !== ollamaHost],
      ["image-generation", "ComfyUI server URL", comfyUri !== comfyuiHost],
      [
        "image-generation",
        "Default checkpoint model",
        comfyModel !== comfyuiDefaultModel,
      ],
      ["image-generation", "Default image size", comfySize !== savedComfySize],
      [
        "image-generation",
        "Negative prompt",
        comfyNegative !== comfyuiNegativePrompt,
      ],
      ["web-search", "SearXNG server URL", searxngUri !== searxngHost],
    ];
    return settingChanges
      .filter(([, , changed]) => changed)
      .map(([tab, label]) => ({ tab, label }));
  }, [
    settings,
    currentSettings,
    ollamaUri,
    ollamaHost,
    comfyUri,
    comfyuiHost,
    comfyModel,
    comfyuiDefaultModel,
    comfySize,
    savedComfySize,
    comfyNegative,
    comfyuiNegativePrompt,
    searxngUri,
    searxngHost,
  ]);
  const isDirty = changes.length > 0;

  const discardChanges = useCallback(() => {
    setSettings(currentSettings);
    setOllamaUri(ollamaHost);
    setComfyUri(comfyuiHost);
    setComfyModel(comfyuiDefaultModel);
    setComfySize(savedComfySize);
    setComfyNegative(comfyuiNegativePrompt);
    setSearxngUri(searxngHost);
    setTestState({ status: "idle" });
    setComfyTestState({ status: "idle" });
    setSearxngTestState({ status: "idle" });
    setError(null);
  }, [
    currentSettings,
    ollamaHost,
    comfyuiHost,
    comfyuiDefaultModel,
    savedComfySize,
    comfyuiNegativePrompt,
    searxngHost,
  ]);

  const handleSubmit = useCallback(async (): Promise<boolean> => {
    if (!isDirty) return true;
    setIsSaving(true);
    setError(null);
    try {
      const { width, height } = parseSize(comfySize);
      await onSave(
        settings,
        ollamaUri,
        {
          host: comfyUri,
          defaultModel: comfyModel,
          defaultWidth: width,
          defaultHeight: height,
          negativePrompt: comfyNegative,
        },
        {
          host: searxngUri,
        },
      );
      setTestState({ status: "idle" });
      setComfyTestState({ status: "idle" });
      setSearxngTestState({ status: "idle" });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
      return false;
    } finally {
      setIsSaving(false);
    }
  }, [
    isDirty,
    settings,
    ollamaUri,
    comfyUri,
    comfyModel,
    comfySize,
    comfyNegative,
    searxngUri,
    onSave,
  ]);

  const availableModels = ollamaModels;

  const onOllamaUriInput = useCallback((v: string) => {
    setOllamaUri(v);
    setTestState({ status: "idle" });
  }, []);

  const onComfyUriInput = useCallback((v: string) => {
    setComfyUri(v);
    setComfyTestState({ status: "idle" });
  }, []);

  const onSearxngUriInput = useCallback((v: string) => {
    setSearxngUri(v);
    setSearxngTestState({ status: "idle" });
  }, []);

  return {
    settings,
    ollamaUri,
    onOllamaUriInput,
    isSaving,
    changes,
    isDirty,
    discardChanges,
    error,
    testState,
    comfyUri,
    onComfyUriInput,
    comfyModel,
    setComfyModel,
    comfySize,
    setComfySize,
    comfyModels,
    comfyTestState,
    comfyNegative,
    setComfyNegative,
    searxngUri,
    onSearxngUriInput,
    searxngTestState,
    handleChange,
    handleTestOllama,
    handleTestComfyUI,
    handleTestSearXNG,
    handleSubmit,
    availableModels,
  };
}
