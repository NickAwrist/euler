import { useCallback, useEffect, useState } from "react";
import { providerClient } from "../../lib/rpc";
import { fetchComfyUIConfig } from "../../persist/comfyui";
import type { ComfyUIConfigState } from "../../types";

export function useComfyUIConnection() {
  const [comfyuiHost, setComfyuiHost] = useState("");
  const [comfyuiConnected, setComfyuiConnected] = useState<boolean | null>(
    null,
  );
  const [comfyuiDefaultModel, setComfyuiDefaultModel] = useState("");
  const [comfyuiDefaultWidth, setComfyuiDefaultWidth] = useState(1440);
  const [comfyuiDefaultHeight, setComfyuiDefaultHeight] = useState(1440);
  const [comfyuiNegativePrompt, setComfyuiNegativePrompt] = useState("");

  const fetchComfyUIHealth = useCallback(async () => {
    try {
      const { connected } = await providerClient.getComfyUiHealth({});
      setComfyuiConnected(connected);
    } catch {
      setComfyuiConnected(false);
    }
  }, []);

  const applyComfyConfigResponse = useCallback((data: ComfyUIConfigState) => {
    if (typeof data.host === "string") setComfyuiHost(data.host);
    if (typeof data.defaultModel === "string")
      setComfyuiDefaultModel(data.defaultModel);
    if (typeof data.defaultWidth === "number")
      setComfyuiDefaultWidth(data.defaultWidth);
    if (typeof data.defaultHeight === "number")
      setComfyuiDefaultHeight(data.defaultHeight);
    if (typeof data.negativePrompt === "string")
      setComfyuiNegativePrompt(data.negativePrompt);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchComfyUIConfig();
        if (cancelled) return;
        applyComfyConfigResponse(data);
      } catch {
        /* ignore */
      }
      void fetchComfyUIHealth();
    })();
    return () => {
      cancelled = true;
    };
  }, [applyComfyConfigResponse, fetchComfyUIHealth]);

  return {
    comfyuiHost,
    comfyuiConnected,
    comfyuiDefaultModel,
    comfyuiDefaultWidth,
    comfyuiDefaultHeight,
    comfyuiNegativePrompt,
    fetchComfyUIHealth,
    applyComfyConfigResponse,
  };
}
