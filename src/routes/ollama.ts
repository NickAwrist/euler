import { Router } from "express";
import { Ollama } from "ollama";
import { setOllamaHost } from "../db/index";
import { envConfig } from "../env";
import { canEditEnvironmentSetting } from "../http/environmentSettings";
import { withContainerLoopbackHint } from "../models/containerNetworkHint";
import {
  getOllamaClient,
  getOllamaHostConfig,
  invalidateOllamaClientCache,
  normalizeOllamaHost,
} from "../models/ollamaClient";
import { sendValidationError } from "../observability/http";
import { OllamaHostBodySchema } from "../schemas/ollama";
import { errorMessage } from "../utils/errors";

const ollamaRoutes = Router();

ollamaRoutes.get("/health", async (_req, res) => {
  try {
    await getOllamaClient().list();
    res.json({ connected: true });
  } catch (e) {
    res.json({
      connected: false,
      error: errorMessage(e),
    });
  }
});

ollamaRoutes.get("/config", (_req, res) => {
  res.json(getOllamaHostConfig());
});

ollamaRoutes.put("/config", (req, res) => {
  const parsed = OllamaHostBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendValidationError(res, parsed.error);
  const { host } = parsed.data;
  if (canEditEnvironmentSetting(envConfig.ollamaHost, host)) {
    setOllamaHost(host);
  }
  invalidateOllamaClientCache();
  res.json(getOllamaHostConfig());
});

ollamaRoutes.post("/test", async (req, res) => {
  const parsed = OllamaHostBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) return sendValidationError(res, parsed.error);
  const { host } = parsed.data;
  let client: Ollama;
  let effectiveHost: string;
  try {
    client = host ? new Ollama({ host }) : new Ollama();
    effectiveHost = normalizeOllamaHost(host);
  } catch (e) {
    res.json({
      ok: false,
      error: errorMessage(e),
    });
    return;
  }
  try {
    const v = await client.version();
    res.json({
      ok: true,
      version: v.version,
      effectiveHost,
    });
  } catch (e) {
    res.json({
      ok: false,
      error: withContainerLoopbackHint(errorMessage(e), host || effectiveHost),
      effectiveHost,
    });
  }
});

export default ollamaRoutes;
